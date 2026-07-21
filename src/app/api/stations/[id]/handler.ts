import {
  errorResponse,
  jsonResponse,
  logPublicApiFailure,
} from "@/app/api/public-response";
import {
  stationIdSchema,
  stationDetailResponseSchema,
  type StationDetailResult,
} from "@/domain/public-api";

export type StationDetailHandlerDependencies = {
  getStationDetail: (id: string) => Promise<StationDetailResult>;
};

export async function handleStationDetail(
  request: Request,
  rawId: string,
  dependencies: StationDetailHandlerDependencies,
) {
  if (new URL(request.url).searchParams.size > 0) {
    return errorResponse("invalid_input", "Invalid station request.", 400);
  }
  const parsedId = stationIdSchema.safeParse(rawId);
  if (!parsedId.success) {
    return errorResponse("invalid_input", "Invalid station id.", 400);
  }

  try {
    const result = await dependencies.getStationDetail(parsedId.data);
    if (result.status === "dataset-unavailable") {
      return errorResponse(
        "dataset_unavailable",
        "No active fuel dataset is available.",
        503,
      );
    }
    if (result.status === "station-not-found") {
      return errorResponse("station_not_found", "Station not found.", 404);
    }

    return jsonResponse(stationDetailResponseSchema.parse({
      data: {
        extractionDate: result.extractionDate,
        station: result.station,
      },
    }));
  } catch {
    logPublicApiFailure("station_detail");
    return errorResponse("internal_error", "Unable to load the station.", 500);
  }
}
