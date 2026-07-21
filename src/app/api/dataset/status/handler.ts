import {
  errorResponse,
  jsonResponse,
  logPublicApiFailure,
} from "@/app/api/public-response";
import {
  datasetStatusResponseSchema,
  type DatasetStatus,
} from "@/domain/public-api";

export type DatasetStatusHandlerDependencies = {
  getActiveDatasetStatus: () => Promise<DatasetStatus | null>;
};

export async function handleDatasetStatus(
  request: Request,
  dependencies: DatasetStatusHandlerDependencies,
) {
  if (new URL(request.url).searchParams.size > 0) {
    return errorResponse("invalid_input", "Invalid dataset status request.", 400);
  }
  try {
    const status = await dependencies.getActiveDatasetStatus();
    if (!status) {
      return errorResponse(
        "dataset_unavailable",
        "No active fuel dataset is available.",
        503,
      );
    }

    return jsonResponse(datasetStatusResponseSchema.parse({ data: status }));
  } catch {
    logPublicApiFailure("dataset_status");
    return errorResponse("internal_error", "Unable to load dataset status.", 500);
  }
}
