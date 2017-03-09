"use strict";
const path = require("path");
class ServerConfiguration {
    /*don't require logger and everything that has logger as dependency in config.js due to cyclic dependency*/
    constructor($fs, $options) {
        this.$fs = $fs;
        this.$options = $options;
        this.DISABLE_HOOKS = false;
        let baseConfigPath = this.getConfigPath("config-base");
        if (!this.$fs.exists(baseConfigPath)) {
            this.$fs.writeJson(baseConfigPath, this.loadConfig("config-base", { local: true }));
        }
        let configPath = this.getConfigPath("config");
        if (!this.$fs.exists(configPath)) {
            let configBase = this.loadConfig("config-base");
            this.$fs.writeJson(configPath, configBase);
        }
        else {
            this.mergeConfig(this, this.loadConfig("config"));
        }
    }
    reset() {
        return this.$fs.copyFile(this.getConfigPath("config-base"), this.getConfigPath("config"));
    }
    apply(configName) {
        let baseConfig = this.loadConfig("config-base");
        let newConfig = this.loadConfig("config-" + configName);
        this.mergeConfig(baseConfig, newConfig);
        this.saveConfig(baseConfig, "config");
    }
    printConfigData() {
        let config = this.loadConfig("config");
        console.log(config);
    }
    loadConfig(name, options) {
        let configFileName = this.getConfigPath(name, options);
        return this.$fs.readJson(configFileName);
    }
    getConfigPath(filename, options) {
        let dirname = options && options.local ? path.join(__dirname, "../server-configs/") : this.$options.profileDir;
        return path.join(dirname, filename + ".json");
    }
    saveConfig(config, name) {
        let configNoFunctions = Object.create(null);
        _.each(config, (entry, key) => {
            if (typeof entry !== "function") {
                configNoFunctions[key] = entry;
            }
        });
        let configFileName = this.getConfigPath(name);
        return this.$fs.writeJson(configFileName, configNoFunctions);
    }
    mergeConfig(config, mergeFrom) {
        _.extend(config, mergeFrom);
    }
}
exports.ServerConfiguration = ServerConfiguration;
$injector.register("serverConfig", ServerConfiguration);
// export class StaticConfig implements IStaticConfig {
// 	constructor($injector: IInjector) {
// 		this.RESOURCE_DIR_PATH = path.join(this.RESOURCE_DIR_PATH, "../../resources");
// 	}
// 	public RESOURCE_DIR_PATH: string = "";
// 	private static TOKEN_FILENAME = ".abgithub";
// 	public PROJECT_FILE_NAME = ".abproject";
// 	public CLIENT_NAME = "AppBuilder";
// 	public ANALYTICS_API_KEY = "13eaa7db90224aa1861937fc71863ab8";
// 	public ANALYTICS_FEATURE_USAGE_TRACKING_API_KEY = "13eaa7db90224aa1861937fc71863ab8";
// 	public TRACK_FEATURE_USAGE_SETTING_NAME = "AnalyticsSettings.TrackFeatureUsage";
// 	public ERROR_REPORT_SETTING_NAME = "AnalyticsSettings.TrackExceptions";
// 	public ANALYTICS_INSTALLATION_ID_SETTING_NAME = "AnalyticsInstallationID";
// 	public SYS_REQUIREMENTS_LINK = "http://docs.telerik.com/platform/appbuilder/running-appbuilder/running-the-cli/system-requirements-cli";
// 	public SOLUTION_SPACE_NAME = "Private_Build_Folder";
// 	public FULL_CLIENT_NAME = "Telerik AppBuilder CLI by Progress";
// 	public QR_SIZE = 300;
// 	public get GITHUB_ACCESS_TOKEN_FILEPATH(): string {
// 		return path.join(osenv.home(), StaticConfig.TOKEN_FILENAME);
// 	}
// 	public version = require("../package.json").version;
// 	public triggerJsonSchemaValidation = true;
// 	public get helpTextPath() {
// 		return path.join(__dirname, "../resources/help.txt");
// 	}
// 	public get HTML_CLI_HELPERS_DIR(): string {
// 		return path.join(__dirname, "../docs/helpers");
// 	}
// 	public get pathToPackageJson(): string {
// 		return path.join(__dirname, "..", "package.json");
// 	}
// 	public get PATH_TO_BOOTSTRAP(): string {
// 		return path.join(__dirname, "bootstrap");
// 	}
// }
// $injector.register("staticConfig", StaticConfig);
//# sourceMappingURL=server-config.js.map