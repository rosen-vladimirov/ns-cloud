interface IProvision {
	Name: string;
	Identifier: string;
	ApplicationIdentifierPrefix: string;
	ApplicationIdentifier: string;
	ProvisionType: string;
	ExpirationDate: any;
	Certificates: string[];
	ProvisionedDevices: string[];
}

interface ICryptographicIdentity {
	Alias: string;
	Attributes: string[];
	isiOS: boolean;
	Certificate: string;
}
declare module Swagger {

	interface ISwaggerServiceContract {
		apis: ISwaggerApi[];
		models?: IDictionary<CodeGeneration.IModel>;
		apiVersion?: string;
		basePath?: string;
		resourcePath?: string;
		swaggerVersion?: string;
	}

	interface ISwaggerApi {
		path: string;
		operations: IOperation[];
	}

	interface IOperation {
		httpMethod: string;
		nickname: string;
		responseClass: string;
		parameters: IParameter[];
	}

	interface IParameter {
		required: boolean;
		name: string;
		paramType: string;
		dataType: string;
		allowableValues: CodeGeneration.IModelPropertyValue;
	}

	interface ITsTypeSystemHelpers {
		getReadableStreamTypeName(): string;
		getWritableStreamTypeName(): string;
		translate(typeName: string): string;
		isGeneric(typeName: string): boolean;
		isBuiltIn(typeName: string): boolean;
		isModel(modelName: string): boolean;
		isStream(typeName: string): boolean;
		addModel(modelName: string): void;
	}

	interface IServiceEndpoint {
		operationContractName: string;
		callResultType: string;
		endpointInterface: CodeGeneration.ILine;
		endpointImplementation: CodeGeneration.IBlock;
		parameters: string[];
	}
}

declare module Server {
	interface IRequestBodyElement {
		name: string;
		value: any;
		contentType: string;
	}

	interface IServiceProxy {
		call<T>(name: string, method: string, path: string, accept: string, body: IRequestBodyElement[], resultStream: NodeJS.WritableStream, headers?: any): Promise<T>
	}

	interface IAppBuilderServiceProxy extends IServiceProxy {
		makeTapServiceCall<T>(call: () => Promise<T>, solutionSpaceHeaderOptions?: { discardSolutionSpaceHeader: boolean }): Promise<T>
	}

	interface IServiceContractProvider {
		getApi(path?: string): Promise<Swagger.ISwaggerServiceContract>;
	}

	interface IIdentityManager {
		listCertificates(): Promise<void>;
		listProvisions(provisionStr?: string): Promise<void>;
		findCertificate(identityStr: string): Promise<ICryptographicIdentity>;
		findProvision(provisionStr: string): Promise<IProvision>;
		autoselectProvision(appIdentifier: string, provisionTypes: string[], deviceIdentifier?: string): Promise<IProvision>;
		autoselectCertificate(provision: IProvision): Promise<ICryptographicIdentity>;
		isCertificateCompatibleWithProvision(certificate: ICryptographicIdentity, provision: IProvision): boolean;
		findReleaseCertificate(): Promise<ICryptographicIdentity>;
	}

	interface IPackageDef {
		platform: string;
		solution: string;
		solutionPath: string;
		relativePath: string;
		localFile?: string;
		disposition: string;
		format: string;
		url: string;
		fileName: string;
		key?: string;
		value?: string;
		architecture?: string;
	}

	interface IBuildResult {
		buildResults: IPackageDef[];
		output: string;
		errors: string[];
	}
}

interface IServerConfiguration extends IConfiguration{
	USE_CDN_FOR_EXTENSION_DOWNLOAD: boolean;

	/**
	 * Resets config.json to it's default values.
	 * @returns {void}
	 */
	reset(): void;

	/**
	 * Applies specific configuration and saves it in config.json
	 * @param {string} configName The name of the configuration to be applied.
	 * @returns {void}
	 */
	apply(configName: string): void;
	printConfigData(): void;
}

interface ICloudBuildService {
	build(projectDir: string, projectId: string): Promise<any>;
}