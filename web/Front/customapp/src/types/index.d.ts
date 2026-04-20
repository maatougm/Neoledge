export interface Status {
  key: string
  value: string
}
export interface ResponseModel {
  message: string
  anomalies: string[]
}

export interface SampleResponse extends ResponseModel {
  subject: string
}

export interface SampleRequest {
  subject: string
}