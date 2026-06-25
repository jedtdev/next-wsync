import { Api } from "@/lib/api";
import { api } from "@/lib/wsync";
import { StatusCodes } from "http-status-codes";
import { NextRequest } from "next/server";

export { api as UPGRADE };

export async function GET(
  _: NextRequest,
  { params }: RouteContext<"/api/wsync/[[...slug]]">,
) {
  const session = null;
  if (!session)
    return Api.status(StatusCodes.UNAUTHORIZED).json(({ statusText }) => ({
      error: statusText,
    }));
  const { slug } = await params;
  const channel = slug?.[0];
  if (!channel) {
    return Api.status(StatusCodes.OK).json({
      channel,
      count: api.stats.channel(),
      clients: api.stats.snapshot(),
    });
  }
  if (!api.channels.has(channel)) {
    return Api.status(StatusCodes.NOT_FOUND).json(({ status, statusText }) => ({
      status,
      error: statusText,
    }));
  }
  return Api.status(StatusCodes.OK).json({
    channel,
    count: api.stats.channel(channel),
    clients: api.stats.snapshot(channel),
  });
}
