import * as path from "path";
export class CloudBuild implements ICommand {
	constructor(private $errors: IErrors,
		private $logger: ILogger,
		private $mobileHelper: Mobile.IMobileHelper,
		private $projectData: IProjectData,
		private $cloudBuildService: ICloudBuildService,
		private $options: IOptions,
		private $fs: IFileSystem) {
	}

	public async execute(args: string[]): Promise<void> {
		const platform = this.$mobileHelper.validatePlatformName(args[0]);
		this.$logger.warn(`Executing cloud build with platform: ${platform}.`);
		// build(projectDir: string, projectId: string, platform: string, nativescriptData: any, buildConfiguration: string)
		const nativescriptData = this.$fs.readJson(path.join(this.$projectData.projectDir, "package.json")).nativescript;
		const pathToCertificate = path.resolve(this.$options.keyStorePath);
		const pathToProvision = path.resolve(this.$options.provision);
		await this.$cloudBuildService.build(this.$projectData.projectDir, this.$projectData.projectId, platform, nativescriptData, "Release",
		{ pathToCertificate, certificatePassword: "123456" },
		{ pathToCertificate, certificatePassword: "1", pathToProvision });
	}

	public async canExecute(args: string[]): Promise<boolean> {
		if (!args || !args.length) {
			this.$errors.fail("Provide platform.");
		}

		if (args.length > 1) {
			this.$errors.fail("Only a single platform is supported.");
		}

		return true;
	}

	allowedParameters: ICommandParameter[];
}
$injector.registerCommand("build|cloud", CloudBuild);
