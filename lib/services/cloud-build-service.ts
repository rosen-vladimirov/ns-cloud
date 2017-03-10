import * as path from "path";
import * as semver from "semver";
import * as uuid from "uuid";
import * as constants from "../constants";
import * as pem from "pem"
const provisioning = require("provisioning");

interface IAmazonStorageEntryData extends CloudService.AmazonStorageEntry {
	fileNameInS3: string;
}

export class CloudBuildService implements ICloudBuildService {

	constructor(private $fs: IFileSystem,
		private $httpClient: Server.IHttpClient,
		private $projectFilesManager: IProjectFilesManager,
		private $errors: IErrors,
		private $server: CloudService.IServer,
		private $mobileHelper: Mobile.IMobileHelper) { }

	// We should decorate this method... hacks are needed!!!
	public async build(projectSettings: IProjectSettings,
		platform: string, buildConfiguration: string,
		androidBuildData?: IAndroidBuildData,
		iOSBuildData?: IIOSBuildData): Promise<IBuildResultData> {

		// TODO: Add validation for all options before uploading the package to S3.
		await this.validateBuildProperties(platform, buildConfiguration, androidBuildData, iOSBuildData);
		let buildProps = await this.prepareBuildRequest(projectSettings, platform, buildConfiguration);

		// TODO: Check with Nadya why we do not receive this information.
		let outputFileName = projectSettings.projectName;

		if (this.$mobileHelper.isAndroidPlatform(platform)) {
			buildProps = await this.getAndroidBuildProperties(projectSettings, buildProps, androidBuildData);
			outputFileName += ".apk";
		} else if (this.$mobileHelper.isiOSPlatform(platform)) {
			buildProps = await this.getiOSBuildProperties(projectSettings, buildProps, iOSBuildData);
			if (iOSBuildData.buildForDevice) {
				outputFileName += ".ipa";
			} else {
				outputFileName += ".zip";
			}
		}

		const buildResult: any = await this.$server.appsBuild.buildProject(projectSettings.projectId, buildProps);

		if (!buildResult.BuildItems || !buildResult.BuildItems.length) {
			// Something failed
			// Fail with combination of Errors and Output:
			this.$errors.failWithoutHelp(`Build failed. Reason is: ${buildResult.Errors}. Additional information: ${buildResult.Output}.`);
		}

		const localBuildResult = await this.downloadBuildResult(buildResult, projectSettings.projectDir, outputFileName);

		return {
			stderr: buildResult.Error,
			stdout: buildResult.Output,
			outputFilePath: localBuildResult
		};
	}

	public async validateBuildProperties(platform: string, buildConfiguration: string, androidBuildData?: IAndroidBuildData,
		iOSBuildData?: IIOSBuildData): Promise<void> {
		if (this.$mobileHelper.isAndroidPlatform(platform) && this.isReleaseConfiguration(buildConfiguration)) {
			if (!androidBuildData || !androidBuildData.pathToCertificate) {
				this.$errors.failWithoutHelp("When building for Release configuration, you must specify valid Certificate and its password.");
			}

			if (!this.$fs.exists(androidBuildData.pathToCertificate)) {
				this.$errors.failWithoutHelp(`The specified certificate: ${androidBuildData.pathToCertificate} does not exist. Verify the location is correct.`);
			}
		} else if (this.$mobileHelper.isiOSPlatform(platform) && iOSBuildData.buildForDevice) {
			if (!iOSBuildData || !iOSBuildData.pathToCertificate || !iOSBuildData.certificatePassword || !iOSBuildData.pathToProvision) {
				this.$errors.failWithoutHelp("When building for iOS you must specify valid Mobile Provision, Certificate and its password.");
			}

			if (!this.$fs.exists(iOSBuildData.pathToCertificate)) {
				this.$errors.failWithoutHelp(`The specified certificate: ${iOSBuildData.pathToCertificate} does not exist. Verify the location is correct.`);
			}

			if (!this.$fs.exists(iOSBuildData.pathToProvision)) {
				this.$errors.failWithoutHelp(`The specified provision: ${iOSBuildData.pathToProvision} does not exist. Verify the location is correct.`);
			}

			let certData = this.getCertificateBase64((await this.getCertificateData(iOSBuildData.pathToCertificate, iOSBuildData.certificatePassword)).cert);
			let provisionCertificatesBase64 = (await this.getMobileProvisionData(iOSBuildData.pathToProvision)).DeveloperCertificates.map(c => c.toString('base64'));

			if (!_.includes(provisionCertificatesBase64, certData)) {
				this.$errors.failWithoutHelp(`The specified provision: ${iOSBuildData.pathToProvision} does not include the specified certificate: ${iOSBuildData.pathToCertificate}. Please specify a different provision or certificate.`);
			}
		}
	}

	private async prepareBuildRequest(projectSettings: { projectDir: string, projectId: string, projectName: string, nativescriptData: any },
		platform: string, buildConfiguration: string): Promise<any> {

		const projectZipFile = await this.zipProject(projectSettings.projectDir);
		const buildPreSignedUrlData = await this.uploadFileToS3(projectSettings.projectId, projectZipFile);

		// HACK just for this version. After that we'll have UI for getting runtime version.
		// Until then, use the coreModulesVersion.
		const coreModulesVersion = this.$fs.readJson(path.join(projectSettings.projectDir, "package.json")).dependencies["tns-core-modules"];
		const runtimeVersion = this.getRuntimeVersion(platform, projectSettings.nativescriptData, coreModulesVersion);
		const cliVersion = await this.getCliVersion(runtimeVersion);

		return {
			Properties: {
				ProjectConfiguration: buildConfiguration,
				BuildConfiguration: buildConfiguration,
				Platform: platform,
				AppIdentifier: projectSettings.projectId,
				FrameworkVersion: cliVersion,
				RuntimeVersion: runtimeVersion,
				AcceptResults: "Url;LocalPath",
				SessionKey: buildPreSignedUrlData.SessionKey,
				TemplateAppName: projectSettings.projectName,
				Framework: "tns"
			},
			BuildFiles: [
				{
					disposition: "PackageZip",
					sourceUri: buildPreSignedUrlData.S3Url
				}
			],
			Target: []
		};

	}

	private async uploadFileToS3(projectId: string, localFilePath: string, extension: string = ""): Promise<IAmazonStorageEntryData> {
		const fileNameInS3 = uuid.v4() + extension;
		const preSignedUrlData = await this.$server.appsBuild.getPresignedUploadUrlObject(projectId, fileNameInS3);

		const requestOpts: any = {
			url: preSignedUrlData.UploadPreSignedUrl,
			method: "PUT"
		};

		requestOpts.body = this.$fs.readFile(localFilePath);

		try {
			await this.$httpClient.httpRequest(requestOpts);
		} catch (err) {
			this.$errors.failWithoutHelp(`Error while uploading ${localFilePath} to S3. Errors is:`, err.message);
		}

		const amazonStorageEntryData: IAmazonStorageEntryData = _.merge({ fileNameInS3 }, preSignedUrlData, );

		return amazonStorageEntryData;
	}

	private getCertificateBase64(cert: string) {
		return cert.substr(constants.CRYPTO.CERTIFICATE_HEADER.length).slice(0, -constants.CRYPTO.CERTIFICATE_FOOTER.length).replace(/\s/g, "");
	}

	private async getAndroidBuildProperties(projectSettings: IProjectSettings,
		buildProps: any,
		androidBuildData?: IAndroidBuildData): Promise<any> {

		const buildConfiguration = buildProps.Properties.BuildConfiguration;

		if (this.isReleaseConfiguration(buildConfiguration)) {
			const certificateS3Data = await this.uploadFileToS3(projectSettings.projectId, androidBuildData.pathToCertificate);

			buildProps.Properties.keyStoreName = certificateS3Data.fileNameInS3;
			buildProps.Properties.keyStoreAlias = await this.getCertificateCommonName(androidBuildData.pathToCertificate, androidBuildData.certificatePassword);
			buildProps.Properties.keyStorePassword = androidBuildData.certificatePassword;
			buildProps.Properties.keyStoreAliasPassword = androidBuildData.certificatePassword;

			buildProps.BuildFiles.push({
				disposition: "CryptoStore",
				sourceUri: certificateS3Data.S3Url
			});
		}

		return buildProps;
	}

	private async getiOSBuildProperties(projectSettings: IProjectSettings,
		buildProps: any,
		iOSBuildData: IIOSBuildData): Promise<any> {

		if (iOSBuildData.buildForDevice) {
			const certificateS3Data = await this.uploadFileToS3(projectSettings.projectId, iOSBuildData.pathToCertificate);
			const provisonS3Data = await this.uploadFileToS3(projectSettings.projectId, iOSBuildData.pathToProvision, ".mobileprovision");

			// Add to buildProps.Properties some of these.
			// "Simulator": "False",
			// "BuildForiOSSimulator": false,

			// "iOSCodesigningIdentity": certificateS3Data.fileNameInS3,
			// "CodeSigningIdentity": "iPhone Developer: Dragon Telrrikov (J45P439R9U)",
			// "TempKeychainName": uuid.v4(),
			// "TempKeychainPassword": iOSBuildData.certificatePassword,
			// "MobileProvisionIdentifiers": [{
			// 	"SuffixId": "",
			// 	"TemplateName": "PROVISION_",
			// 	"Identifier": provisonS3Data.fileNameInS3,
			// 	"IsDefault": true,
			// 	"FileName": provisonS3Data.fileNameInS3,
			// 	"AppGroups": [],
			// 	"ProvisionType": "Development",
			// 	"Name": provisonS3Data.fileNameInS3
			// }],

			buildProps.BuildFiles.push(
				{
					sourceUri: certificateS3Data.S3Url,
					disposition: "Keychain"
				},
				{
					sourceUri: provisonS3Data.S3Url,
					disposition: "Provision"
				}
			);

			buildProps.Properties.CertificatePassword = iOSBuildData.certificatePassword;
			buildProps.Properties.CodeSigningIdentity = await this.getCertificateCommonName(iOSBuildData.pathToCertificate, iOSBuildData.certificatePassword);
			const provisionData = await this.getMobileProvisionData(iOSBuildData.pathToProvision);
			const cloudProvisionsData: any[] = [{
				SuffixId: "",
				TemplateName: "PROVISION_",
				Identifier: provisionData.UUID,
				IsDefault: true,
				FileName: `${provisonS3Data.fileNameInS3}`,
				AppGroups: [],
				ProvisionType: this.getProvisionType(provisionData),
				Name: provisionData.Name
			}];
			buildProps.Properties.MobileProvisionIdentifiers = JSON.stringify(cloudProvisionsData);
			buildProps.Properties.DefaultMobileProvisionIdentifier = provisionData.UUID;
		} else {
			buildProps.Properties.Simulator = true;
		}

		return buildProps;
	}

	private getProvisionType(provisionData: IMobileProvisionData): string {
		// TODO: Discuss whether this code should be moved to the Tooling
		let result = "";
		if (provisionData.Entitlements['get-task-allow']) {
			result = "Development";
		} else {
			result = "AdHoc";
		}

		if (!provisionData.ProvisionedDevices || !provisionData.ProvisionedDevices.length) {
			if (provisionData.ProvisionsAllDevices) {
				result = "Enterprise";
			} else {
				result = "App Store";
			}
		}

		return result;
	}

	private async downloadBuildResult(buildResult: any, projectDir: string, outputFileName: string): Promise<string> {
		const buildResultUrl = _.find(buildResult.BuildItems, (b: any) => b.Disposition === "BuildResult").FullPath;
		const destinationDir = path.join(projectDir, constants.CLOUD_TEMP_DIR_NAME);
		this.$fs.ensureDirectoryExists(destinationDir);

		const targetFileName = path.join(destinationDir, outputFileName);
		const targetFile = this.$fs.createWriteStream(targetFileName);

		// Download the output file.
		await this.$httpClient.httpRequest({
			url: buildResultUrl,
			pipeTo: targetFile
		});

		return targetFileName;
	}

	private async zipProject(projectDir: string): Promise<string> {
		let tempDir = path.join(projectDir, constants.CLOUD_TEMP_DIR_NAME);
		this.$fs.ensureDirectoryExists(tempDir);

		let projectZipFile = path.join(tempDir, "Build.zip");
		this.$fs.deleteFile(projectZipFile);

		let files = this.$projectFilesManager.getProjectFiles(projectDir, ["node_modules", "platforms", constants.CLOUD_TEMP_DIR_NAME]);

		await this.$fs.zipFiles(projectZipFile, files,
			p => this.getProjectRelativePath(p, projectDir));

		return projectZipFile;
	}

	private getProjectRelativePath(fullPath: string, projectDir: string): string {
		projectDir = path.join(projectDir, path.sep);
		if (!_.startsWith(fullPath, projectDir)) {
			throw new Error("File is not part of the project.");
		}

		return fullPath.substring(projectDir.length);
	}

	private getRuntimeVersion(platform: string, nativescriptData: any, coreModulesVersion: string): string {
		const runtimePackageName = `tns-${platform.toLowerCase()}`;
		let runtimeVersion = nativescriptData && nativescriptData[runtimePackageName] && nativescriptData[runtimePackageName].version;
		if (!runtimeVersion && coreModulesVersion && semver.valid(coreModulesVersion)) {
			// no runtime added. Let's find out which one we need based on the tns-core-modules.
			runtimeVersion = `${semver.major(coreModulesVersion)}.${semver.minor(coreModulesVersion)}.*`;
		}

		return runtimeVersion || "2.5.0";
	}

	private async getCliVersion(runtimeVersion: string): Promise<string> {
		try {
			const response = await this.$httpClient.httpRequest("http://registry.npmjs.org/nativescript");
			const versions = _.keys(JSON.parse(response.body).versions);
			return "2.5.0" || semver.maxSatisfying(versions, `~${runtimeVersion}`);
		} catch (err) {
			return `${semver.major(runtimeVersion)}.${semver.minor(runtimeVersion)}.0`;
		}
	}

	private async getCertificateCommonName(certificatePath: string, certificatePassword: string): Promise<string> {
		return (await this.getCertificateInfo(certificatePath, certificatePassword)).commonName;
	}

	private async getCertificateInfo(certificatePath: string, certificatePassword: string): Promise<pem.CertificateSubjectReadResult> {
		let certData = await this.getCertificateData(certificatePath, certificatePassword);
		return new Promise<pem.CertificateSubjectReadResult>((resolve, reject) => {
			pem.readCertificateInfo(certData.cert, (err, data) => {
				if (err) {
					reject(err);
					return;
				}

				resolve(data);
			});
		});
	}

	private async getCertificateData(certificatePath: string, certificatePassword: string): Promise<ICertificateData> {
		return new Promise<ICertificateData>((resolve, reject) => {
			pem.readPkcs12(path.resolve(certificatePath), { p12Password: certificatePassword }, (err, data: any) => {
				if (err) {
					reject(err);
					return;
				}

				resolve(data);
			});
		});
	}

	private async getMobileProvisionData(provisionPath: string): Promise<IMobileProvisionData> {
		return new Promise<IMobileProvisionData>((resolve, reject) => {
			provisioning(path.resolve(provisionPath), (err: Error, obj: any) => {
				if (err) {
					reject(err);
					return;
				}

				resolve(obj);
			});
		});
	}

	private isReleaseConfiguration(buildConfiguration: string): boolean {
		return buildConfiguration.toLowerCase() === constants.RELEASE_CONFIGURATION_NAME;
	}
}
$injector.register("cloudBuildService", CloudBuildService);
