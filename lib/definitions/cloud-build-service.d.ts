interface IBuildResultData {
	stderr: string;
	stdout: string;
	outputFilePath: string;
}

interface ICloudBuildService {
	build(projectSettings: IProjectSettings,
		platform: string, buildConfiguration: string,
		androidBuildData?: IAndroidBuildData,
		iOSBuildData?: IIOSBuildData): Promise<IBuildResultData>;
}

interface IProjectSettings {
	projectDir: string;
	projectId: string;
	projectName: string;
	nativescriptData: any;
}

interface IAndroidBuildData {
	pathToCertificate: string;
	certificatePassword: string;
}

interface IIOSBuildData extends IBuildForDevice {
	pathToProvision: string;
	pathToCertificate: string;
	certificatePassword: string;
}
