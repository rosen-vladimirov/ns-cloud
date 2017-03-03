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
		private $server: CloudService.IServer) { }

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

	// TODO: add params for provision, certificates, etc.
	// TODO: check what to do with server configuration - it should be at profile-dir level
	// TODO: get all required interfaces from Server.
	public async build(projectDir: string, projectId: string, platform: string, nativescriptData: any, buildConfiguration: string,
		androidBuildData: { pathToCertificate: string, certificatePassword: string },
		iOSBuildData: { pathToProvision: string, pathToCertificate: string, certificatePassword: string }): Promise<any> {

		const projectZipFile = await this.zipProject(projectDir);
		const buildPreSignedUrlData = await this.uploadFileToS3(projectId, projectZipFile);

		// TODO: Pass this as parameter.
		const projectName = path.basename(projectDir);

		const certificateS3Data = await this.uploadFileToS3(projectId, iOSBuildData.pathToCertificate);
		const provisonS3Data = await this.uploadFileToS3(projectId, iOSBuildData.pathToProvision);

		// const certificateS3Data = await this.uploadFileToS3(projectId, androidBuildData.pathToCertificate);

		// HACK just for this version. After that we'll have UI for getting runtime version.
		// Until then, use the coreModulesVersion.
		const coreModulesVersion = this.$fs.readJson(path.join(projectDir, "package.json")).dependencies["tns-core-modules"];
		const runtimeVersion = this.getRuntimeVersion(platform, nativescriptData, coreModulesVersion);
		const cliVersion = await this.getCliVersion(runtimeVersion);

		console.log("runtimeVersion = ", runtimeVersion, " cliVersion = ", cliVersion);

		let buildProps: any = {
			"Properties": {
				"ProjectConfiguration": buildConfiguration,
				"BuildConfiguration": buildConfiguration,
				"Platform": platform,
				"AppIdentifier": projectId,
				"FrameworkVersion": cliVersion,
				"RuntimeVersion": runtimeVersion,
				"BuildForiOSSimulator": false,
				"AcceptResults": "Url;LocalPath",
				"SessionKey": buildPreSignedUrlData.SessionKey,
				"TemplateAppName": projectName,
				"Framework": "tns",
				// "keyStoreName": certificateS3Data.fileNameInS3,
				// "keyStoreAlias": certificateS3Data.fileNameInS3,
				// "keyStorePassword": androidBuildData.certificatePassword,
				// "keyStoreAliasPassword": androidBuildData.certificatePassword

				"Simulator": "False",

				"iOSCodesigningIdentity": certificateS3Data.fileNameInS3,
				//	"CodeSigningIdentity": "iPhone Developer: Dragon Telrrikov (J45P439R9U)",


				"TempKeychainName": uuid.v4(),
				"TempKeychainPassword": iOSBuildData.certificatePassword,
				"MobileProvisionIdentifiers": [{
					"SuffixId": "",
					"TemplateName": "PROVISION_",
					"Identifier": provisonS3Data.fileNameInS3,
					"IsDefault": true,
					"FileName": provisonS3Data.fileNameInS3,
					"AppGroups": [],
					"ProvisionType": "Development",
					"Name": provisonS3Data.fileNameInS3
				}],
			},
			"BuildFiles": [
				{
					"disposition": "PackageZip",
					"sourceUri": buildPreSignedUrlData.S3Url
				}
				,
				// For Android cloud builds:
				// {
				// 	"disposition": "CryptoStore",
				// 	"sourceUri": certificateS3Data.S3Url
				// },

				// For iOS Cloud builds
				{
					"sourceUri": certificateS3Data.S3Url,
					"disposition": "Keychain"
				}, {
					"sourceUri": provisonS3Data.S3Url,
					"disposition": "Provision"
				}

			],
			"Target": []
		};

		let buildResult: any = await this.$server.appsBuild.buildProject(projectId, buildProps);

		// TODO: Check for errors!!!
		let buildResultUrl = _.find(buildResult.BuildItems, (b: any) => b.Disposition === "BuildResult").FullPath;
		console.log("$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$$", buildResultUrl);
		this.$fs.ensureDirectoryExists(path.join(projectDir, ".ab"));
		const targetFileName = path.join(projectDir, ".ab", `${projectName}.apk`);
		const targetFile = this.$fs.createWriteStream(targetFileName);

		await this.$httpClient.httpRequest({
			url: buildResultUrl,
			pipeTo: targetFile
		});
	}

	private async zipProject(projectDir: string): Promise<string> {
		let tempDir = path.join(projectDir, ".ab");
		this.$fs.ensureDirectoryExists(tempDir);

		let projectZipFile = path.join(tempDir, "Build.zip");
		this.$fs.deleteFile(projectZipFile);

		let files = this.$projectFilesManager.getProjectFiles(projectDir, ["node_modules", "platforms"]);

		await this.$fs.zipFiles(projectZipFile, files,
			p => this.getProjectRelativePath(p, projectDir));
		console.log("files = ", files);
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