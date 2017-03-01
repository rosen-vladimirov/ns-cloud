import * as path from "path";
$injector.requirePublic("cloudBuildService", path.join(__dirname, "cloud-build-service"));
$injector.require("serviceProxy", path.join(__dirname, "service-proxy"));
$injector.require("serverConfig", path.join(__dirname, "server-config"));
$injector.requireCommand("build|cloud", path.join(__dirname, "cloud-build"));