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
		const nativescriptData = this.$fs.readJson(path.join(this.$projectData.projectDir, "package.json")).nativescript;
		const pathToCertificate = this.$options.keyStorePath ? path.resolve(this.$options.keyStorePath) : "";
		const pathToProvision = this.$options.provision ? path.resolve(this.$options.provision) : "";
		const projectSettings = { projectDir: this.$projectData.projectDir, projectId: this.$projectData.projectId, projectName: this.$projectData.projectName, nativescriptData };
		const buildConfiguration = this.$options.release ? "Release" : "Debug";
		await this.$cloudBuildService.build(projectSettings,
			platform, buildConfiguration,
			{ pathToCertificate, certificatePassword: this.$options.keyStorePassword },
			{ pathToCertificate, certificatePassword: this.$options.keyStorePassword, pathToProvision });
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
