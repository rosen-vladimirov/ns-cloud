import * as path from "path";
import * as semver from "semver";
import * as uuid from "uuid";

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
	public async build(projectSettings: { projectDir: string, projectId: string, projectName: string, nativescriptData: any },
		platform: string, buildConfiguration: string,
		androidBuildData?: { pathToCertificate: string, certificatePassword: string },
		iOSBuildData?: { pathToProvision: string, pathToCertificate: string, certificatePassword: string }): Promise<IBuildResultData> {

		// TODO: Add validation for all options before uploading the package to S3.

		let buildProps = await this.prepareBuildRequest(projectSettings, platform, buildConfiguration);

		// TODO: Check with Nadya why we do not receive this information.
		let outputFileName = projectSettings.projectName;

		if (this.$mobileHelper.isAndroidPlatform(platform)) {
			buildProps = await this.getAndroidBuildProperties(projectSettings, buildProps, androidBuildData);
			outputFileName += ".apk";
		} else if (this.$mobileHelper.isiOSPlatform(platform)) {
			buildProps = await this.getiOSBuildProperties(projectSettings, buildProps, iOSBuildData);
			if (buildProps.Properties.BuildForiOSSimulator) {
				outputFileName += ".zip";
			} else {
				outputFileName += ".ipa";
			}
		}

		const buildResult: any = await this.$server.appsBuild.buildProject(projectSettings.projectId, buildProps);

		if (!buildResult.BuildItems) {
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

	private async uploadFileToS3(projectId: string, localFilePath: string): Promise<IAmazonStorageEntryData> {
		const fileNameInS3 = uuid.v4();
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

	private async getAndroidBuildProperties(projectSettings: { projectDir: string, projectId: string, projectName: string },
		buildProps: any,
		androidBuildData?: { pathToCertificate: string, certificatePassword: string }): Promise<any> {

		const buildConfiguration = buildProps.Properties.BuildConfiguration;

		if (buildConfiguration === "Release") {
			if (!androidBuildData || !androidBuildData.pathToCertificate || !androidBuildData.certificatePassword) {
				this.$errors.failWithoutHelp("When building for Release configuration, you must specify valid Certificate and its password.");
			}

			if (!this.$fs.exists(androidBuildData.pathToCertificate)) {
				this.$errors.failWithoutHelp(`The specified certificate: ${androidBuildData.pathToCertificate} does not exist. Verify the location is correct.`);
			}

			const certificateS3Data = await this.uploadFileToS3(projectSettings.projectId, androidBuildData.pathToCertificate);

			buildProps.Properties.keyStoreName = certificateS3Data.fileNameInS3;
			buildProps.Properties.keyStoreAlias = certificateS3Data.fileNameInS3;
			buildProps.Properties.keyStorePassword = androidBuildData.certificatePassword;
			buildProps.Properties.keyStoreAliasPassword = androidBuildData.certificatePassword;

			buildProps.BuildFiles.push({
				disposition: "CryptoStore",
				sourceUri: certificateS3Data.S3Url
			});
		}

		return buildProps;
	}

	private async getiOSBuildProperties(projectSettings: { projectDir: string, projectId: string, projectName: string },
		buildProps: any,
		iOSBuildData: { pathToProvision: string, pathToCertificate: string, certificatePassword: string }): Promise<any> {

		if (!iOSBuildData || !iOSBuildData.pathToCertificate || !iOSBuildData.certificatePassword || !iOSBuildData.pathToProvision) {
			this.$errors.failWithoutHelp("When building for iOS you must specify valid Mobile Provision, Certificate and its password.");
		}

		if (!this.$fs.exists(iOSBuildData.pathToCertificate)) {
			this.$errors.failWithoutHelp(`The specified certificate: ${iOSBuildData.pathToCertificate} does not exist. Verify the location is correct.`);
		}

		if (!this.$fs.exists(iOSBuildData.pathToProvision)) {
			this.$errors.failWithoutHelp(`The specified provision: ${iOSBuildData.pathToCertificate} does not exist. Verify the location is correct.`);
		}

		const certificateS3Data = await this.uploadFileToS3(projectSettings.projectId, iOSBuildData.pathToCertificate);
		const provisonS3Data = await this.uploadFileToS3(projectSettings.projectId, iOSBuildData.pathToProvision);

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

		return buildProps;
	}

	private async downloadBuildResult(buildResult: any, projectDir: string, outputFileName: string): Promise<string> {
		const buildResultUrl = _.find(buildResult.BuildItems, (b: any) => b.Disposition === "BuildResult").FullPath;
		const destinationDir = path.join(projectDir, ".ab");
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
		let tempDir = path.join(projectDir, ".ab");
		this.$fs.ensureDirectoryExists(tempDir);

		let projectZipFile = path.join(tempDir, "Build.zip");
		this.$fs.deleteFile(projectZipFile);

		let files = this.$projectFilesManager.getProjectFiles(projectDir, ["node_modules", "platforms", ".ab"]);

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
			return semver.maxSatisfying(versions, `~${runtimeVersion}`);
		} catch (err) {
			return `${semver.major(runtimeVersion)}.${semver.minor(runtimeVersion)}.0`;
		}
	}
}
$injector.register("cloudBuildService", CloudBuildService);
