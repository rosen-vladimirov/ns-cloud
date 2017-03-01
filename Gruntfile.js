"use strict";

const path = require("path");
const fs = require("fs");
const _ = require("lodash");
const os = require("os");
const nodeArgs = [];
const getBuildVersion = (version) => {
	let buildVersion = version !== undefined ? version : process.env["BUILD_NUMBER"];
	if (process.env["BUILD_CAUSE_GHPRBCAUSE"]) {
		buildVersion = "PR" + buildVersion;
	}

	return buildVersion;
}

module.exports = function (grunt) {

	// Windows cmd does not accept paths with / and unix shell does not accept paths with \\ and we need to execute from a sub-dir.
	// To circumvent the issue, hack our environment's PATH and let the OS deal with it, which in practice works
	process.env.path = process.env.path + (os.platform() === "win32" ? ";" : ":") + "node_modules/.bin";

	let isPackageJsonModified = false;

	const defaultEnvironment = "sit";
	grunt.initConfig({
		deploymentEnvironment: process.env["DeploymentEnvironment"] || defaultEnvironment,
		resourceDownloadEnvironment: process.env["ResourceDownloadEnvironment"] || defaultEnvironment,
		jobName: process.env["JOB_NAME"] || defaultEnvironment,
		buildNumber: process.env["BUILD_NUMBER"] || "non-ci",

		pkg: grunt.file.readJSON("package.json"),
		ts: {
			options: grunt.file.readJSON("tsconfig.json").compilerOptions,

			devlib: {
				src: ["lib/**/*.ts"],
				reference: "lib/.d.ts"
			},

			devall: {
				src: ["lib/**/*.ts", "test/**/*.ts"],
				reference: "lib/.d.ts"
			},

			release_build: {
				src: ["lib/**/*.ts", "test/**/*.ts"],
				reference: "lib/.d.ts",
				options: {
					sourceMap: false,
					removeComments: true
				}
			}
		},

		tslint: {
			build: {
				files: {
					src: ["lib/**/*.ts", "test/**/*.ts", "definitions/**/*.ts"]
				},
				options: {
					configuration: grunt.file.readJSON("./tslint.json")
				}
			}
		},

		watch: {
			devall: {
				files: ["lib/**/*.ts", "test/**/*.ts"],
				tasks: ['ts:devall'],
				options: {
					atBegin: true,
					interrupt: true
				}
			}
		},

		shell: {
			options: {
				stdout: true,
				stderr: true
			},

			apply_resources_environment: {
				command: "node " + nodeArgs.join(" ") + " bin/appbuilder dev-config-apply <%= resourceDownloadEnvironment %>"
			},

			prepare_resources: {
				command: "node " + nodeArgs.join(" ") + " bin/appbuilder dev-prepackage"
			},

			ci_unit_tests: {
				command: "npm test",
				options: {
					execOptions: {
						env: (function () {
							var env = _.cloneDeep(process.env);
							env["XUNIT_FILE"] = "test-reports.xml";
							env["LOG_XUNIT"] = "true";
							return env;
						})()
					}
				}
			},

			apply_deployment_environment: {
				command: "node " + nodeArgs.join(" ") + " bin/appbuilder dev-config-apply <%= deploymentEnvironment %>"
			},

			build_package: {
				command: "npm pack",
				options: {
					execOptions: {
						env: (function () {
							var env = _.cloneDeep(process.env);
							env["APPBUILDER_SKIP_POSTINSTALL_TASKS"] = "1";
							return env;
						})()
					}
				}
			}
		},

		clean: {
			src: ["test/**/*.js*",
				"lib/**/*.js*",
				"*.tgz"]
		}
	});

	grunt.loadNpmTasks("grunt-contrib-clean");
	grunt.loadNpmTasks("grunt-contrib-watch");
	grunt.loadNpmTasks("grunt-shell");
	grunt.loadNpmTasks("grunt-ts");
	grunt.loadNpmTasks("grunt-tslint");

	grunt.registerTask("set_package_version", function (version) {
		const buildVersion = getBuildVersion(version);
		const packageJson = grunt.file.readJSON("package.json");
		packageJson.buildVersion = buildVersion;
		grunt.file.write("package.json", JSON.stringify(packageJson, null, "  "));
	});

	grunt.registerTask("setPackageName", function (version) {
		const fs = require("fs");
		const fileExtension = ".tgz";
		const buildVersion = getBuildVersion(version);
		const packageJson = grunt.file.readJSON("package.json");
		const oldFileName = packageJson.name + "-" + packageJson.version;
		const newFileName = oldFileName + "-" + buildVersion;
		fs.renameSync(oldFileName + fileExtension, newFileName + fileExtension);
	});

	grunt.registerTask("delete_coverage_dir", function () {
		const done = this.async();
		const rimraf = require("rimraf");
		rimraf("coverage", function (err) {
			if (err) {
				console.log("Error while deleting coverage directory from the package.");
				done(false);
			}

			done();
		});
	});

	grunt.registerTask("test", ["ts:devall", "shell:ci_unit_tests"]);

	grunt.registerTask("remove_prepublish_script", function () {
		const packageJson = grunt.file.readJSON("package.json");
		if (packageJson && packageJson.scripts && packageJson.scripts.prepublish) {
			delete packageJson.scripts.prepublish;
			grunt.file.write("package.json", JSON.stringify(packageJson, null, "  "));
			isPackageJsonModified = true;
		}
	});

	grunt.registerTask("printPackageJsonWarning", function () {
		if (isPackageJsonModified) {
			require("colors");
			console.log("NOTE: `grunt pack` command modified package.json. DO NOT COMMIT these changes, they are required only for the produced .tgz.".red.bold);
		}
	});

	grunt.registerTask("generate_references", () => {
		const referencesPath = path.join(__dirname, "references.d.ts");

		// get all .d.ts files from nativescript-cli and mobile-cli-lib
		const nodeModulesDirPath = path.join(__dirname, "node_modules");
		const pathsOfDtsFiles = getReferencesFromDir(path.join(nodeModulesDirPath, "nativescript"))
									.concat(getReferencesFromDir(path.join(nodeModulesDirPath, "mobile-cli-lib")));

		const lines = pathsOfDtsFiles.map(file => `/// <reference path="${fromWindowsRelativePathToUnix(path.relative(__dirname, file))}" />`);

		fs.writeFileSync(referencesPath, lines.join(os.EOL));
	});

	const fromWindowsRelativePathToUnix = (windowsRelativePath) => {
		return windowsRelativePath.replace(/\\/g, "/");
	}

	// returns paths that have to be added to reference.d.ts.
	const getReferencesFromDir = (dir) => {
		const currentDirContent = fs.readdirSync(dir).map(item => path.join(dir, item));
		let pathsToDtsFiles = [];
		_.each(currentDirContent, d => {
			const stat = fs.statSync(d);
			if (stat.isDirectory() && path.basename(d) !== "node_modules") {
				// recursively check all dirs for .d.ts files.
				pathsToDtsFiles = pathsToDtsFiles.concat(getReferencesFromDir(d));
			} else if (stat.isFile() && d.endsWith(".d.ts")) {
				pathsToDtsFiles.push(d);
			}
		});

		return pathsToDtsFiles;
	};

	grunt.registerTask("pack", [
		"clean",

		"ts:release_build",

		"remove_prepublish_script",

		"shell:apply_resources_environment",
		"shell:prepare_resources",
		"shell:apply_deployment_environment",
		"shell:ci_unit_tests",

		"set_package_version",
		"delete_coverage_dir",
		"shell:build_package",
		"setPackageName",
		"printPackageJsonWarning"
	]);
	grunt.registerTask("lint", ["tslint:build"]);
	grunt.registerTask("all", ["clean", "test", "lint"]);
	grunt.registerTask("rebuild", ["clean", "ts:devlib"]);
	grunt.registerTask("default", "ts:devlib");
};
