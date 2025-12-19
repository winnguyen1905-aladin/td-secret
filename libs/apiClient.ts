import got, { OptionsOfJSONResponseBody } from "got";

type JobsResponse = {
	data: string[];
	message: string;
	statusCode: number;
	timestamp: string;
};

export async function getUserJobs(params: {
	baseUrl?: string | undefined;
	userId: string;
	token: string;
}): Promise<string[]> {
	const { baseUrl, token } = params;
	if (!baseUrl) {
		throw new Error("JOBS_SERVICE_URL or JOBS_SERVICE_URL is not configured");
	}
	const normalizedBase = baseUrl.replace(/\/+$/, "");
	const url = `${normalizedBase}/jobs/ids`;
	const authHeader = token?.startsWith("Bearer ") ? token : `Bearer ${token}`;

	const requestOptions: OptionsOfJSONResponseBody = {
		headers: {
			accept: "application/json",
			authorization: authHeader,
		},
		responseType: "json",
		retry: {
			limit: 3,
			methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
			statusCodes: [408, 413, 429, 500, 502, 503, 504],
		},
		timeout: {
			request: 5000,
		},
	};

	const response = await got.get(url, requestOptions);

	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new Error(`Failed to fetch user jobs: ${response.statusCode} ${response.statusMessage}`);
	}

	const body = response.body as unknown;
	const jobsResponse = body as JobsResponse;

	if (!jobsResponse || !Array.isArray(jobsResponse.data)) {
		return [];
	}

	return jobsResponse.data;
}
