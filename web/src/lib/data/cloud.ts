// Client for the accounts / cloud-deck API hosted by the proxy (proxy/src/accounts.mjs).
// The session token is kept in this browser's localStorage and sent as a bearer token.

const TOKEN_KEY = "edopro_session";

export interface CloudUser {
  username: string;
  createdAt: string;
}

export interface CloudDeck {
  id: string;
  name: string;
  /** The .ydk exactly as it was saved. */
  ydk: string;
  createdAt: string;
  updatedAt: string;
}

export class CloudError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the session lasts until the page closes */
  }
}

export class CloudApi {
  private token: string | null = readToken();

  constructor(private base: string) {
    this.base = base.replace(/\/+$/, "");
  }

  get signedIn() {
    return !!this.token;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new CloudError(0, "Can't reach the server. Please try again later.");
    }
    if (res.status === 401 && this.token && !path.startsWith("/api/auth/login")) {
      // The session expired or was signed out elsewhere.
      this.token = null;
      writeToken(null);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error;
      if (res.status === 429) throw new CloudError(429, msg ?? "Too many requests. Please wait a moment.");
      if (res.status === 404 && !msg) throw new CloudError(404, "Cloud decks aren't available on this server.");
      throw new CloudError(res.status, msg ?? `Request failed (${res.status}).`);
    }
    return data as T;
  }

  private signIn(r: { token: string; user: CloudUser }) {
    this.token = r.token;
    writeToken(r.token);
    return r.user;
  }

  async register(username: string, password: string) {
    return this.signIn(await this.call("POST", "/api/auth/register", { username, password }));
  }

  async login(username: string, password: string) {
    return this.signIn(await this.call("POST", "/api/auth/login", { username, password }));
  }

  async logout() {
    try {
      await this.call("POST", "/api/auth/logout");
    } finally {
      this.token = null;
      writeToken(null);
    }
  }

  async me() {
    return (await this.call<{ user: CloudUser }>("GET", "/api/auth/me")).user;
  }

  async deleteAccount(password: string) {
    await this.call("DELETE", "/api/auth/account", { password });
    this.token = null;
    writeToken(null);
  }

  async listDecks() {
    return this.call<{ decks: CloudDeck[]; limit: number }>("GET", "/api/decks");
  }

  async createDeck(name: string, ydk: string) {
    return (await this.call<{ deck: CloudDeck }>("POST", "/api/decks", { name, ydk })).deck;
  }

  async updateDeck(id: string, name: string, ydk: string) {
    return (await this.call<{ deck: CloudDeck }>("PUT", `/api/decks/${id}`, { name, ydk })).deck;
  }

  async deleteDeck(id: string) {
    await this.call("DELETE", `/api/decks/${id}`);
  }
}
