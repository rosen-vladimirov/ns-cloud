"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
class ServiceProxy {
    constructor($httpClient, $logger, $serverConfig, $errors) {
        this.$httpClient = $httpClient;
        this.$logger = $logger;
        this.$serverConfig = $serverConfig;
        this.$errors = $errors;
    }
    call(name, method, path, accept, bodyValues, resultStream, headers) {
        return __awaiter(this, void 0, void 0, function* () {
            path = `appbuilder/${path}`;
            headers = headers || Object.create(null);
            headers["X-Icenium-SolutionSpace"] = headers["X-Icenium-SolutionSpace"] || "Private_Build_Folder";
            if (accept) {
                headers.Accept = accept;
            }
            let requestOpts = {
                proto: this.$serverConfig.AB_SERVER_PROTO,
                host: this.$serverConfig.AB_SERVER,
                path: `/${path}`,
                method: method,
                headers: headers,
                pipeTo: resultStream
            };
            if (bodyValues) {
                if (bodyValues.length > 1) {
                    throw new Error("TODO: CustomFormData not implemented");
                }
                let theBody = bodyValues[0];
                requestOpts.body = theBody.value;
                requestOpts.headers["Content-Type"] = theBody.contentType;
            }
            let response;
            try {
                response = yield this.$httpClient.httpRequest(requestOpts);
            }
            catch (err) {
                if (err.response && err.response.statusCode === 402) {
                    this.$errors.fail({ formatStr: "%s", suppressCommandHelp: true }, JSON.parse(err.body).Message);
                }
                throw err;
            }
            this.$logger.debug("%s (%s %s) returned %d", name, method, path, response.response.statusCode);
            const resultValue = accept === "application/json" ? JSON.parse(response.body) : response.body;
            return resultValue;
        });
    }
}
exports.ServiceProxy = ServiceProxy;
$injector.register("serviceProxy", ServiceProxy);
//# sourceMappingURL=service-proxy.js.map