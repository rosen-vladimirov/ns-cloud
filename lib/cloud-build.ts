export class CloudBuild implements ICommand {
	constructor(private $errors: IErrors,
		private $logger: ILogger,
		private $mobileHelper: Mobile.IMobileHelper,
		private $projectData: IProjectData,
		private $cloudBuildService: ICloudBuildService) {
	}

	public async execute(args: string[]): Promise<void> {
		const platform = this.$mobileHelper.validatePlatformName(args[0]);
		this.$logger.warn(`Executing cloud build with platform: ${platform}.`);
		await this.$cloudBuildService.build(this.$projectData.projectDir, this.$projectData.projectId);
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
