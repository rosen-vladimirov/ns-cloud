interface ICloudBuildService {
		build(projectDir: string,
			projectId: string,
			platform: string,
			nativescriptData: any,
			buildConfiguration: string,
			androidBuildData: { pathToCertificate: string, certificatePassword: string },
			iOSBuildData: { pathToProvision: string, pathToCertificate: string, certificatePassword: string }
		 ): Promise<any>;
}