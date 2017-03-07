"use strict";
const querystring = require("querystring");
class AppsBuildService {
    constructor($serviceProxy) {
        this.$serviceProxy = $serviceProxy;
    }
    buildProject(appId, buildRequest) {
        return this.$serviceProxy.call('BuildProject', 'POST', ['api', 'apps', encodeURI(appId.replace(/\\/g, '/')), 'build'].join('/'), 'application/json', [{ name: 'buildRequest', value: JSON.stringify(buildRequest), contentType: 'application/json' }], null);
    }
    getPresignedUploadUrlObject(appId, fileName) {
        return this.$serviceProxy.call('GetPresignedUploadUrlObject', 'GET', ['api', 'apps', encodeURI(appId.replace(/\\/g, '/')), 'build', 'uploadurl'].join('/') + '?' + querystring.stringify({ 'fileName': fileName }), 'application/json', null, null);
    }
}
exports.AppsBuildService = AppsBuildService;
class ServiceContainer {
    constructor($injector) {
        this.$injector = $injector;
        this.appsBuild = this.$injector.resolve(AppsBuildService);
    }
}
exports.ServiceContainer = ServiceContainer;
$injector.register("server", ServiceContainer);
//# sourceMappingURL=cloud-service.js.map