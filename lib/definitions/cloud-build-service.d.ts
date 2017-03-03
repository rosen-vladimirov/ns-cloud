interface IBuildResultData {
	stderr: string;
	stdout: string;
	outputFilePath: string;
}

interface ICloudBuildService {
	build(projectSettings: { projectDir: string, projectId: string, projectName: string, nativescriptData: any },
		platform: string, buildConfiguration: string,
		androidBuildData?: { pathToCertificate: string, certificatePassword: string },
		iOSBuildData?: { pathToProvision: string, pathToCertificate: string, certificatePassword: string }): Promise<IBuildResultData>;
}
