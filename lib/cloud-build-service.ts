import * as path from "path";
import * as querystring from "querystring";
export class CloudBuildService implements ICloudBuildService {
	constructor(private $serviceProxy: Server.IServiceProxy,
		private $projectData: IProjectData,
		private $fs: IFileSystem,
		private $httpClient: Server.IHttpClient) { }

	public async build(projectDir: string, projectId: string): Promise<any> {

		let fusionSpecificSettings = await this.getPresignedUploadUrlObject(this.$projectData.projectId, "build.zip");
		console.log(" ############## fusionSpecificSettings", fusionSpecificSettings);
		const projectName = path.basename(projectDir);

		console.log("######### projectDir: ", projectDir, " projectId: ", projectId);
		let projectZipFile = path.join(projectDir, "build.zip");
		let requestOpts: any = {
			url: fusionSpecificSettings.UploadPreSignedUrl,
			method: "PUT"
		};

		requestOpts.body = this.$fs.readFile(projectZipFile);

		try {
			await this.$httpClient.httpRequest(requestOpts);
		} catch (err) {
			console.log("ERRR WHILE UPLOADING TO S3: ", err);
			throw err;
		}

		let buildProps: any = {
			"Properties": {
				"ProjectConfiguration": "Debug",
				"BuildConfiguration": "Debug",
				"Platform": "Android",
				"AppIdentifier": projectId,
				"ProjectName": projectName,
				"Author": "",
				"Description": projectName,
				"FrameworkVersion": "2.5.0",
				"BundleVersion": "1.0",
				"DeviceOrientations": "Portrait;Landscape",
				"BuildForiOSSimulator": false,
				"AcceptResults": "Url;LocalPath",
				"SessionKey": fusionSpecificSettings.SessionKey,
				"TemplateAppName": projectName,
				"Framework": "tns",
				"AndroidPermissions": "android.permission.INTERNET",
				"AndroidVersionCode": "1",
				"AndroidHardwareAcceleration": "true",
				"AndroidCodesigningIdentity": ""
			},
			"BuildFiles": [{
				"disposition": "PackageZip",
				"sourceUri": fusionSpecificSettings.S3Url
			}],
			"Target": []
		};

		await this.buildProject1(projectId, buildProps);
	}

	public buildProject1(appId: string, buildRequest: Server.BuildRequestData): Promise<Server.Object> {
		return this.$serviceProxy.call<Server.Object>('BuildProject', 'POST', ['api', 'apps', encodeURI(appId.replace(/\\/g, '/')), 'build'].join('/'), 'application/json', [{ name: 'buildRequest', value: JSON.stringify(buildRequest), contentType: 'application/json' }], null);
	}
	public getPresignedUploadUrlObject(appId: string, fileName: string): Promise<Server.AmazonStorageEntry> {
		return this.$serviceProxy.call<Server.AmazonStorageEntry>('GetPresignedUploadUrlObject', 'GET', ['api', 'apps', encodeURI(appId.replace(/\\/g, '/')), 'build', 'uploadurl'].join('/') + '?' + querystring.stringify({ 'fileName': fileName }), 'application/json', null, null);
	}
}
$injector.register("cloudBuildService", CloudBuildService);