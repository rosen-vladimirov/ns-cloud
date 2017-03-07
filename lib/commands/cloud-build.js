"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const path = require("path");
class CloudBuild {
    constructor($errors, $logger, $mobileHelper, $projectData, $cloudBuildService, $options, $fs) {
        this.$errors = $errors;
        this.$logger = $logger;
        this.$mobileHelper = $mobileHelper;
        this.$projectData = $projectData;
        this.$cloudBuildService = $cloudBuildService;
        this.$options = $options;
        this.$fs = $fs;
        this.$projectData.initializeProjectData();
    }
    execute(args) {
        return __awaiter(this, void 0, void 0, function* () {
            const platform = this.$mobileHelper.validatePlatformName(args[0]);
            this.$logger.warn(`Executing cloud build with platform: ${platform}.`);
            const nativescriptData = this.$fs.readJson(path.join(this.$projectData.projectDir, "package.json")).nativescript;
            let pathToCertificate = "";
            if (this.$mobileHelper.isAndroidPlatform(platform)) {
                pathToCertificate = this.$options.keyStorePath ? path.resolve(this.$options.keyStorePath) : "";
            }
            else if (this.$mobileHelper.isiOSPlatform(platform)) {
                pathToCertificate = this.$options.certificate ? path.resolve(this.$options.certificate) : "";
            }
            else {
                this.$errors.failWithoutHelp(`Currently only ${this.$mobileHelper.platformNames.join(' ')} platforms are supported.`);
            }
            const pathToProvision = this.$options.provision ? path.resolve(this.$options.provision) : "";
            const projectSettings = { projectDir: this.$projectData.projectDir, projectId: this.$projectData.projectId, projectName: this.$projectData.projectName, nativescriptData };
            const buildConfiguration = this.$options.release ? "Release" : "Debug";
            yield this.$cloudBuildService.build(projectSettings, platform, buildConfiguration, { pathToCertificate, certificatePassword: this.$options.keyStorePassword }, { pathToCertificate, certificatePassword: this.$options.certificatePassword, pathToProvision });
        });
    }
    canExecute(args) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!args || !args.length) {
                this.$errors.fail("Provide platform.");
            }
            if (args.length > 1) {
                this.$errors.fail("Only a single platform is supported.");
            }
            return true;
        });
    }
}
exports.CloudBuild = CloudBuild;
$injector.registerCommand("build|cloud", CloudBuild);
//# sourceMappingURL=cloud-build.js.map