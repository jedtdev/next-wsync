import { getReasonPhrase, StatusCodes } from 'http-status-codes';
import mime from 'mime-types';
import { NextResponse } from 'next/server';

interface FileOptions {
  buffer: BodyInit;
  filename: string;
  mimeType?: string;
  attachment?: boolean; // true = download, false = view inline
}

interface StatusInfo {
  status: StatusCodes;
  statusText: string;
}

type StatusBuilder = ReturnType<typeof Api.status>;
type StatusFactory = (status: StatusCodes) => StatusBuilder;

interface MethodDefinition {
  status: StatusCodes;
  handler: (builder: StatusBuilder) => NextResponse<unknown>;
}

type MethodFn = (s: StatusFactory) => NextResponse<unknown>;
type MethodInput = MethodDefinition | MethodFn;

type ResolvedMethod<M extends MethodInput> = M extends MethodDefinition
  ? (error?: unknown) => ReturnType<M['handler']>
  : M extends MethodFn
    ? (error?: unknown) => ReturnType<M>
    : never;

type ResolvedMethods<M extends Record<string, MethodInput>> = {
  [K in keyof M]: ResolvedMethod<M[K]>;
};
export class Api {
  public static route<M extends Record<string, MethodInput>>(params: {
    path: string;
    method: string;
    name?: string;
    methods?: M;
  }): {
    status: (status: StatusCodes, error?: unknown) => StatusBuilder;
    methods: ResolvedMethods<M>;
  } {
    const { name = '', method = 'GET', path = '/', methods } = params;
    const log = (status: StatusCodes, error?: unknown) => {
      if (error)
        console.error(`[${name}] ${method} ${path} — Error=${error}`, error);
      const statusText = getReasonPhrase(status);
      console.log(
        `[${name}] ${method} ${path} — Status=${status} StatusText=${statusText}`,
      );
    };
    const resolvedMethods = Object.fromEntries(
      Object.entries({ ...methods }).map(([key, def]) => [
        key,
        (error?: unknown) => {
          if (typeof def === 'function') {
            let capturedStatus: StatusCodes = StatusCodes.OK;
            const factory: StatusFactory = (s) => {
              capturedStatus = s;
              return this.status(s);
            };
            const response = def(factory);
            log(capturedStatus, error);
            return response;
          } else {
            const { status, handler } = def;
            log(status, error);
            return handler(this.status(status));
          }
        },
      ]),
    ) as ResolvedMethods<M>;
    return {
      status: (status: StatusCodes, error?: unknown) => {
        log(status, error);
        return this.status(status);
      },
      methods: resolvedMethods,
    };
  }

  public static status(status: StatusCodes) {
    const statusText = getReasonPhrase(status);
    const statusInfo: StatusInfo = { status, statusText };
    return {
      json<JsonBody extends object = object>(
        body: JsonBody | ((info: StatusInfo) => JsonBody),
        init?: ResponseInit,
      ): NextResponse<JsonBody> {
        const resolvedBody =
          typeof body === 'function' ? body(statusInfo) : body;
        return NextResponse.json(resolvedBody, {
          status,
          statusText,
          ...init,
        });
      },
      redirect(
        url: string | URL | ((info: StatusInfo) => string | URL),
        init?: ResponseInit,
      ): NextResponse<unknown> {
        const resolvedUrl = typeof url === 'function' ? url(statusInfo) : url;
        return NextResponse.redirect(resolvedUrl, {
          status,
          statusText,
          ...init,
        });
      },
      raw<Body = unknown>(
        body?: BodyInit | null | ((info: StatusInfo) => BodyInit | null),
        init?: ResponseInit,
      ): NextResponse<Body> {
        const resolvedBody =
          typeof body === 'function' ? body(statusInfo) : body;
        return new NextResponse(resolvedBody, {
          status,
          statusText,
          ...init,
        });
      },
      file(
        options: FileOptions | ((info: StatusInfo) => FileOptions),
      ): NextResponse<unknown> {
        const resolvedOptions =
          typeof options === 'function' ? options(statusInfo) : options;
        const {
          buffer,
          filename,
          mimeType,
          attachment = true,
        } = resolvedOptions;
        const contentType =
          mimeType || mime.lookup(filename) || 'application/octet-stream';
        const encodedFilename = encodeURIComponent(filename);
        const disposition = attachment ? 'attachment' : 'inline';
        return new NextResponse(buffer, {
          status,
          statusText,
          headers: {
            'Content-Type': contentType,
            'Content-Disposition': `${disposition}; filename="${filename}"; filename*=UTF-8''${encodedFilename}`,
            'Cache-Control': 'no-cache',
          },
        });
      },
    };
  }
}
