interface DeploymentConfig {
  mode: "local" | "cloud"
  localApiBaseUrl: string
  cloudEnvId: string
  cloudServiceName: string
}

export const DEPLOYMENT_CONFIG: DeploymentConfig = {
  mode: "cloud",
  localApiBaseUrl: "http://127.0.0.1:8000",
  cloudEnvId: "forest-disease-d7g3wo6lt4cda1c65",
  cloudServiceName: "forest-disease-api",
}

export const API_MODE = DEPLOYMENT_CONFIG.mode
export const LOCAL_API_BASE_URL = DEPLOYMENT_CONFIG.localApiBaseUrl
export const CLOUD_ENV_ID = DEPLOYMENT_CONFIG.cloudEnvId
export const CLOUD_SERVICE_NAME = DEPLOYMENT_CONFIG.cloudServiceName
