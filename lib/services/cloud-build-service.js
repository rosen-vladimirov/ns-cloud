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
const semver = require("semver");
const uuid = require("uuid");
const os_1 = require("os");
const constants = require("../constants");
const forge = require("node-forge");
const plist = require("simple-plist");
class CloudBuildService {
    constructor($fs, $httpClient, $projectFilesManager, $errors, $server, $mobileHelper, $projectHelper) {
        this.$fs = $fs;
        this.$httpClient = $httpClient;
        this.$projectFilesManager = $projectFilesManager;
        this.$errors = $errors;
        this.$server = $server;
        this.$mobileHelper = $mobileHelper;
        this.$projectHelper = $projectHelper;
    }
    // We should decorate this method... hacks are needed!!!
    build(projectSettings, platform, buildConfiguration, androidBuildData, iOSBuildData) {
        return __awaiter(this, void 0, void 0, function* () {
            // TODO: Add validation for all options before uploading the package to S3.
            yield this.validateBuildProperties(platform, buildConfiguration, projectSettings.projectId, androidBuildData, iOSBuildData);
            let buildProps = yield this.prepareBuildRequest(projectSettings, platform, buildConfiguration);
            // TODO: Check with Nadya why we do not receive this information.
            let outputFileName = projectSettings.projectName;
            if (this.$mobileHelper.isAndroidPlatform(platform)) {
                buildProps = yield this.getAndroidBuildProperties(projectSettings, buildProps, androidBuildData);
                outputFileName += ".apk";
            }
            else if (this.$mobileHelper.isiOSPlatform(platform)) {
                buildProps = yield this.getiOSBuildProperties(projectSettings, buildProps, iOSBuildData);
                if (iOSBuildData.buildForDevice) {
                    outputFileName += ".ipa";
                }
                else {
                    outputFileName += ".zip";
                }
            }
            const buildResult = yield this.$server.appsBuild.buildProject(projectSettings.projectId, buildProps);
            if (!buildResult.BuildItems || !buildResult.BuildItems.length) {
                // Something failed
                // Fail with combination of Errors and Output:
                this.$errors.failWithoutHelp(`Build failed. Reason is: ${buildResult.Errors}. Additional information: ${buildResult.Output}.`);
            }
            const localBuildResult = yield this.downloadBuildResult(buildResult, projectSettings.projectDir, outputFileName);
            return {
                stderr: buildResult.Error,
                stdout: buildResult.Output,
                outputFilePath: localBuildResult
            };
        });
    }
    validateBuildProperties(platform, buildConfiguration, appId, androidBuildData, iOSBuildData) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.$mobileHelper.isAndroidPlatform(platform) && this.isReleaseConfiguration(buildConfiguration)) {
                if (!androidBuildData || !androidBuildData.pathToCertificate) {
                    this.$errors.failWithoutHelp("When building for Release configuration, you must specify valid Certificate and its password.");
                }
                if (!this.$fs.exists(androidBuildData.pathToCertificate)) {
                    this.$errors.failWithoutHelp(`The specified certificate: ${androidBuildData.pathToCertificate} does not exist. Verify the location is correct.`);
                }
            }
            else if (this.$mobileHelper.isiOSPlatform(platform) && iOSBuildData.buildForDevice) {
                if (!iOSBuildData || !iOSBuildData.pathToCertificate || !iOSBuildData.certificatePassword || !iOSBuildData.pathToProvision) {
                    this.$errors.failWithoutHelp("When building for iOS you must specify valid Mobile Provision, Certificate and its password.");
                }
                if (!this.$fs.exists(iOSBuildData.pathToCertificate)) {
                    this.$errors.failWithoutHelp(`The specified certificate: ${iOSBuildData.pathToCertificate} does not exist. Verify the location is correct.`);
                }
                if (!this.$fs.exists(iOSBuildData.pathToProvision)) {
                    this.$errors.failWithoutHelp(`The specified provision: ${iOSBuildData.pathToProvision} does not exist. Verify the location is correct.`);
                }
                const certInfo = this.getCertificateInfo(iOSBuildData.pathToCertificate, iOSBuildData.certificatePassword);
                const certBase64 = this.getCertificateBase64(certInfo.pemCert);
                const provisionData = this.getMobileProvisionData(iOSBuildData.pathToProvision);
                const provisionCertificatesBase64 = _.map(provisionData.DeveloperCertificates, c => c.toString('base64'));
                const now = Date.now();
                let provisionAppId = provisionData.Entitlements['application-identifier'];
                _.each(provisionData.ApplicationIdentifierPrefix, prefix => {
                    provisionAppId = provisionAppId.replace(`${prefix}.`, "");
                });
                let errors = [];
                if (provisionAppId !== "*") {
                    let provisionIdentifierPattern = new RegExp(this.getRegexPattern(provisionAppId));
                    if (!provisionIdentifierPattern.test(appId)) {
                        errors.push(`The specified provision's (${iOSBuildData.pathToProvision}) application identifier (${provisionAppId}) doesn't match your project's application identifier (${appId}).`);
                    }
                }
                if (certInfo.organization !== constants.APPLE_INC) {
                    errors.push(`The specified certificate: ${iOSBuildData.pathToCertificate} is issued by an untrusted organization. Please provide a certificate issued by ${constants.APPLE_INC}`);
                }
                if (now > provisionData.ExpirationDate.getTime()) {
                    errors.push(`The specified provision: ${iOSBuildData.pathToProvision} has expired.`);
                }
                if (now < certInfo.validity.notBefore.getTime() || now > certInfo.validity.notAfter.getTime()) {
                    errors.push(`The specified certificate: ${iOSBuildData.pathToCertificate} has expired.`);
                }
                if (!_.includes(provisionCertificatesBase64, certBase64)) {
                    errors.push(`The specified provision: ${iOSBuildData.pathToProvision} does not include the specified certificate: ${iOSBuildData.pathToCertificate}. Please specify a different provision or certificate.`);
                }
                if (errors.length) {
                    this.$errors.failWithoutHelp(errors.join(os_1.EOL));
                }
            }
        });
    }
    prepareBuildRequest(projectSettings, platform, buildConfiguration) {
        return __awaiter(this, void 0, void 0, function* () {
            const projectZipFile = yield this.zipProject(projectSettings.projectDir);
            const buildPreSignedUrlData = yield this.uploadFileToS3(projectSettings.projectId, projectZipFile);
            // HACK just for this version. After that we'll have UI for getting runtime version.
            // Until then, use the coreModulesVersion.
            const coreModulesVersion = this.$fs.readJson(path.join(projectSettings.projectDir, "package.json")).dependencies["tns-core-modules"];
            const runtimeVersion = this.getRuntimeVersion(platform, projectSettings.nativescriptData, coreModulesVersion);
            const cliVersion = yield this.getCliVersion(runtimeVersion);
            return {
                Properties: {
                    ProjectConfiguration: buildConfiguration,
                    BuildConfiguration: buildConfiguration,
                    Platform: platform,
                    AppIdentifier: projectSettings.projectId,
                    FrameworkVersion: cliVersion,
                    RuntimeVersion: runtimeVersion,
                    AcceptResults: "Url;LocalPath",
                    SessionKey: buildPreSignedUrlData.SessionKey,
                    TemplateAppName: this.$projectHelper.sanitizeName(projectSettings.projectName),
                    Framework: "tns"
                },
                BuildFiles: [
                    {
                        disposition: "PackageZip",
                        sourceUri: buildPreSignedUrlData.S3Url
                    }
                ],
                Target: []
            };
        });
    }
    uploadFileToS3(projectId, localFilePath, extension = "") {
        return __awaiter(this, void 0, void 0, function* () {
            const fileNameInS3 = uuid.v4() + extension;
            const preSignedUrlData = yield this.$server.appsBuild.getPresignedUploadUrlObject(projectId, fileNameInS3);
            const requestOpts = {
                url: preSignedUrlData.UploadPreSignedUrl,
                method: "PUT"
            };
            requestOpts.body = this.$fs.readFile(localFilePath);
            try {
                yield this.$httpClient.httpRequest(requestOpts);
            }
            catch (err) {
                this.$errors.failWithoutHelp(`Error while uploading ${localFilePath} to S3. Errors is:`, err.message);
            }
            const amazonStorageEntryData = _.merge({ fileNameInS3 }, preSignedUrlData);
            return amazonStorageEntryData;
        });
    }
    getCertificateBase64(cert) {
        return cert.replace(/\s/g, "").substr(constants.CRYPTO.CERTIFICATE_HEADER.length).slice(0, -constants.CRYPTO.CERTIFICATE_FOOTER.length);
    }
    getAndroidBuildProperties(projectSettings, buildProps, androidBuildData) {
        return __awaiter(this, void 0, void 0, function* () {
            const buildConfiguration = buildProps.Properties.BuildConfiguration;
            if (this.isReleaseConfiguration(buildConfiguration)) {
                const certificateS3Data = yield this.uploadFileToS3(projectSettings.projectId, androidBuildData.pathToCertificate);
                buildProps.Properties.keyStoreName = certificateS3Data.fileNameInS3;
                buildProps.Properties.keyStoreAlias = yield this.getCertificateCommonName(androidBuildData.pathToCertificate, androidBuildData.certificatePassword);
                buildProps.Properties.keyStorePassword = androidBuildData.certificatePassword;
                buildProps.Properties.keyStoreAliasPassword = androidBuildData.certificatePassword;
                buildProps.BuildFiles.push({
                    disposition: "CryptoStore",
                    sourceUri: certificateS3Data.S3Url
                });
            }
            return buildProps;
        });
    }
    getiOSBuildProperties(projectSettings, buildProps, iOSBuildData) {
        return __awaiter(this, void 0, void 0, function* () {
            if (iOSBuildData.buildForDevice) {
                const certificateS3Data = yield this.uploadFileToS3(projectSettings.projectId, iOSBuildData.pathToCertificate);
                const provisonS3Data = yield this.uploadFileToS3(projectSettings.projectId, iOSBuildData.pathToProvision, ".mobileprovision");
                // Add to buildProps.Properties some of these.
                // "Simulator": "False",
                // "BuildForiOSSimulator": false,
                // "iOSCodesigningIdentity": certificateS3Data.fileNameInS3,
                // "CodeSigningIdentity": "iPhone Developer: Dragon Telrrikov (J45P439R9U)",
                // "TempKeychainName": uuid.v4(),
                // "TempKeychainPassword": iOSBuildData.certificatePassword,
                // "MobileProvisionIdentifiers": [{
                // 	"SuffixId": "",
                // 	"TemplateName": "PROVISION_",
                // 	"Identifier": provisonS3Data.fileNameInS3,
                // 	"IsDefault": true,
                // 	"FileName": provisonS3Data.fileNameInS3,
                // 	"AppGroups": [],
                // 	"ProvisionType": "Development",
                // 	"Name": provisonS3Data.fileNameInS3
                // }],
                buildProps.BuildFiles.push({
                    sourceUri: certificateS3Data.S3Url,
                    disposition: "Keychain"
                }, {
                    sourceUri: provisonS3Data.S3Url,
                    disposition: "Provision"
                });
                buildProps.Properties.CertificatePassword = iOSBuildData.certificatePassword;
                buildProps.Properties.CodeSigningIdentity = yield this.getCertificateCommonName(iOSBuildData.pathToCertificate, iOSBuildData.certificatePassword);
                const provisionData = this.getMobileProvisionData(iOSBuildData.pathToProvision);
                const cloudProvisionsData = [{
                        SuffixId: "",
                        TemplateName: "PROVISION_",
                        Identifier: provisionData.UUID,
                        IsDefault: true,
                        FileName: `${provisonS3Data.fileNameInS3}`,
                        AppGroups: [],
                        ProvisionType: this.getProvisionType(provisionData),
                        Name: provisionData.Name
                    }];
                buildProps.Properties.MobileProvisionIdentifiers = JSON.stringify(cloudProvisionsData);
                buildProps.Properties.DefaultMobileProvisionIdentifier = provisionData.UUID;
            }
            else {
                buildProps.Properties.Simulator = true;
            }
            return buildProps;
        });
    }
    getProvisionType(provisionData) {
        // TODO: Discuss whether this code should be moved to the Tooling
        let result = "";
        if (provisionData.Entitlements['get-task-allow']) {
            result = "Development";
        }
        else {
            result = "AdHoc";
        }
        if (!provisionData.ProvisionedDevices || !provisionData.ProvisionedDevices.length) {
            if (provisionData.ProvisionsAllDevices) {
                result = "Enterprise";
            }
            else {
                result = "App Store";
            }
        }
        return result;
    }
    downloadBuildResult(buildResult, projectDir, outputFileName) {
        return __awaiter(this, void 0, void 0, function* () {
            const buildResultUrl = _.find(buildResult.BuildItems, (b) => b.Disposition === "BuildResult").FullPath;
            const destinationDir = path.join(projectDir, constants.CLOUD_TEMP_DIR_NAME);
            this.$fs.ensureDirectoryExists(destinationDir);
            const targetFileName = path.join(destinationDir, outputFileName);
            const targetFile = this.$fs.createWriteStream(targetFileName);
            // Download the output file.
            yield this.$httpClient.httpRequest({
                url: buildResultUrl,
                pipeTo: targetFile
            });
            return targetFileName;
        });
    }
    zipProject(projectDir) {
        return __awaiter(this, void 0, void 0, function* () {
            let tempDir = path.join(projectDir, constants.CLOUD_TEMP_DIR_NAME);
            this.$fs.ensureDirectoryExists(tempDir);
            let projectZipFile = path.join(tempDir, "Build.zip");
            this.$fs.deleteFile(projectZipFile);
            let files = this.$projectFilesManager.getProjectFiles(projectDir, ["node_modules", "platforms", constants.CLOUD_TEMP_DIR_NAME]);
            yield this.$fs.zipFiles(projectZipFile, files, p => this.getProjectRelativePath(p, projectDir));
            return projectZipFile;
        });
    }
    getProjectRelativePath(fullPath, projectDir) {
        projectDir = path.join(projectDir, path.sep);
        if (!_.startsWith(fullPath, projectDir)) {
            throw new Error("File is not part of the project.");
        }
        return fullPath.substring(projectDir.length);
    }
    getRuntimeVersion(platform, nativescriptData, coreModulesVersion) {
        const runtimePackageName = `tns-${platform.toLowerCase()}`;
        let runtimeVersion = nativescriptData && nativescriptData[runtimePackageName] && nativescriptData[runtimePackageName].version;
        if (!runtimeVersion && coreModulesVersion && semver.valid(coreModulesVersion)) {
            // no runtime added. Let's find out which one we need based on the tns-core-modules.
            runtimeVersion = `${semver.major(coreModulesVersion)}.${semver.minor(coreModulesVersion)}.*`;
        }
        return runtimeVersion || "2.5.0";
    }
    getCliVersion(runtimeVersion) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const response = yield this.$httpClient.httpRequest("http://registry.npmjs.org/nativescript");
                const versions = _.keys(JSON.parse(response.body).versions);
                return "2.5.0" || semver.maxSatisfying(versions, `~${runtimeVersion}`);
            }
            catch (err) {
                return `${semver.major(runtimeVersion)}.${semver.minor(runtimeVersion)}.0`;
            }
        });
    }
    getCertificateCommonName(certificatePath, certificatePassword) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.getCertificateInfo(certificatePath, certificatePassword).commonName;
        });
    }
    getCertificateInfo(certificatePath, certificatePassword) {
        const certificateAbsolutePath = path.resolve(certificatePath);
        const certificateContents = this.$fs.readFile(certificateAbsolutePath, { encoding: 'binary' });
        const pkcs12Asn1 = forge.asn1.fromDer(certificateContents);
        const pkcs12 = forge.pkcs12.pkcs12FromAsn1(pkcs12Asn1, false, certificatePassword);
        for (let safeContens of pkcs12.safeContents) {
            for (let safeBag of safeContens.safeBags) {
                if (safeBag.attributes.localKeyId && safeBag.type === forge.pki.oids['certBag']) {
                    let issuer = safeBag.cert.issuer.getField(constants.CRYPTO.ORGANIZATION_FIELD_NAME);
                    return {
                        pemCert: forge.pki.certificateToPem(safeBag.cert),
                        organization: issuer && issuer.value,
                        validity: safeBag.cert.validity,
                        commonName: safeBag.cert.subject.getField(constants.CRYPTO.COMMON_NAME_FIELD_NAME).value
                    };
                }
            }
        }
        this.$errors.failWithoutHelp(`Could not read ${certificatePath}. Please make sure there is a certificate inside.`);
    }
    getMobileProvisionData(provisionPath) {
        const provisionText = this.$fs.readText(path.resolve(provisionPath));
        const provisionPlistText = provisionText.substring(provisionText.indexOf(constants.CRYPTO.PLIST_HEADER), provisionText.indexOf(constants.CRYPTO.PLIST_FOOTER) + constants.CRYPTO.PLIST_FOOTER.length);
        return plist.parse(provisionPlistText);
    }
    isReleaseConfiguration(buildConfiguration) {
        return buildConfiguration.toLowerCase() === constants.RELEASE_CONFIGURATION_NAME;
    }
    getRegexPattern(appIdentifier) {
        let starPlaceholder = "<!StarPlaceholder!>";
        let escapedIdentifier = this.escape(this.stringReplaceAll(appIdentifier, "*", starPlaceholder));
        let replacedIdentifier = this.stringReplaceAll(escapedIdentifier, starPlaceholder, ".*");
        return "^" + replacedIdentifier + "$";
    }
    escape(s) {
        return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }
    stringReplaceAll(inputString, find, replace) {
        return inputString.split(find).join(replace);
    }
}
exports.CloudBuildService = CloudBuildService;
$injector.register("cloudBuildService", CloudBuildService);
//# sourceMappingURL=cloud-build-service.js.map