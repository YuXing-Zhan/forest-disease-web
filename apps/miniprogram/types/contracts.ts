export type ImageRole =
  | "leaf_front"
  | "leaf_back"
  | "lesion_closeup"
  | "healthy_control"

export interface UploadedImage {
  role: ImageRole
  object_key: string
  size_bytes: number
  stored_size_bytes: number
  processing_ms: number
}

export interface CaseImageInput {
  role: ImageRole
  object_key: string
}

export interface CandidateDisease {
  candidate_id: string
  display_name: string
  evidence_level: string
  supporting_evidence: string[]
  conflicting_evidence: string[]
}

export interface DiagnosisResult {
  strength: "A" | "B" | "C" | "D"
  information: {
    score: number
    provided: string[]
    missing: string[]
  }
  candidates: CandidateDisease[]
  llm_review: {
    status: string
    summary: string
    requested_evidence: string[]
    agreement: string
    reviews: ModelReview[]
  }
  next_actions: string[]
  safety_note: string
}

export interface ModelReview {
  provider: string
  model: string
  status: string
  primary_diagnosis: string
  conclusion: string
  supports_initial_candidate: string
  confidence_level: string
  confidence_basis: string
  confirmed_evidence: string[]
  supporting_evidence: string[]
  uncertainties: string[]
  differential_diagnoses: string[]
  next_actions: string[]
  warning: string
}

export interface DiseaseCase {
  case_id: string
  status: string
  species_input?: string
  images: CaseImageInput[]
  result?: DiagnosisResult
  error_message?: string
  timings?: {
    quality_check_ms?: number
    kindwise_ms?: number
    llm_review_ms?: number
    total_processing_ms?: number
  }
}
