export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors: unknown = null,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Every server response: `{status, status_code, message?, data?, errors?, meta?}`. */
type Envelope<T> = {
  status: "success" | "error";
  status_code: number;
  message?: string;
  data?: T;
  errors?: unknown;
};

export type Tokens = { access: string; refresh: string };

export type RequestOptions = {
  tokens?: Tokens;
  body?: unknown;
  /** Called when a 401 was recovered by refreshing; the caller must persist the new pair. */
  onTokensRefreshed?: (tokens: Tokens) => void;
};

/** HTTP client for the Photon Django server. Lives in main so the renderer never sees the URL. */
export class ApiClient {
  constructor(readonly baseUrl: string) {}

  /** Returns the envelope's `data` (undefined when the server omitted it). */
  async request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
    let tokens = opts.tokens;
    try {
      return await this.send<T>(method, path, tokens?.access, opts.body);
    } catch (err) {
      const canRefresh = err instanceof ApiError && err.status === 401 && tokens?.refresh;
      if (!canRefresh) throw err;
      tokens = await this.refresh(tokens!.refresh);
      opts.onTokensRefreshed?.(tokens);
      return this.send<T>(method, path, tokens.access, opts.body);
    }
  }

  /**
   * POSTs and reads the response as newline-delimited JSON, calling `onLine`
   * per parsed object. Refreshes tokens on 401 like `request`. Aborts via
   * `signal`; an abort resolves quietly rather than throwing.
   */
  async stream<T>(
    path: string,
    opts: RequestOptions & { onLine: (line: T) => void; signal?: AbortSignal },
  ): Promise<void> {
    let tokens = opts.tokens;
    let res = await this.open(path, tokens?.access, opts.body, opts.signal);
    if (res.status === 401 && tokens?.refresh) {
      tokens = await this.refresh(tokens.refresh);
      opts.onTokensRefreshed?.(tokens);
      res = await this.open(path, tokens.access, opts.body, opts.signal);
    }
    if (!res.ok || !res.body) {
      const envelope = (await res.json().catch(() => null)) as Envelope<unknown> | null;
      throw new ApiError(envelope?.message ?? `Request failed (${res.status})`, res.status, envelope?.errors ?? null);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) opts.onLine(JSON.parse(line) as T);
        }
      }
      const rest = buffer.trim();
      if (rest) opts.onLine(JSON.parse(rest) as T);
    } catch (err) {
      if (opts.signal?.aborted) return;
      throw err;
    }
  }

  private async open(path: string, access: string | undefined, body: unknown, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/x-ndjson", "Content-Type": "application/json" };
    if (access) headers.Authorization = `Bearer ${access}`;
    try {
      return await fetch(new URL(path, this.baseUrl), { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (err) {
      if (signal?.aborted) throw err;
      throw new ApiError(`Cannot reach Photon server at ${this.baseUrl}`, 0);
    }
  }

  async refresh(refreshToken: string): Promise<Tokens> {
    return this.send<Tokens>("POST", "/api/auth/token/refresh/", undefined, { refresh: refreshToken });
  }

  private async send<T>(method: Method, path: string, access?: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (access) headers.Authorization = `Bearer ${access}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(new URL(path, this.baseUrl), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(`Cannot reach Photon server at ${this.baseUrl}`, 0);
    }

    const envelope = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!res.ok || envelope?.status === "error") {
      throw new ApiError(
        envelope?.message ?? `Request failed (${res.status})`,
        res.status,
        envelope?.errors ?? null,
      );
    }
    return envelope?.data as T;
  }
}
