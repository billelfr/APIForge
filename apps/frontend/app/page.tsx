"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type SavedRequest = {
  id: string;
  collectionId: string;
  name: string;
  method: string;
  url: string;
  queryParams: Record<string, string>;
  headers: Record<string, string>;
  body: string | null;
};
type Collection = { id: string; name: string; requests?: SavedRequest[] };
type ApiResponse = {
  status: number;
  durationMs: number;
  headers: Record<string, string | string[]>;
  body: string;
};
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const methods: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function formatObject(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function prettyBody(body: string): string {
  try {
    return formatObject(JSON.parse(body));
  } catch {
    return body;
  }
}

export default function Home() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState("");
  const [savedId, setSavedId] = useState("");
  const [requestName, setRequestName] = useState("New request");
  const [method, setMethod] = useState<Method>("GET");
  const [url, setUrl] = useState("");
  const [queryText, setQueryText] = useState("{}");
  const [headersText, setHeadersText] = useState("{}");
  const [bearerToken, setBearerToken] = useState("");
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const loadCollections = useCallback(async () => {
    try {
      const result = await fetch(`${api}/api/collections`);
      if (!result.ok) throw new Error("Could not load collections");
      const data = (await result.json()) as Collection[];
      setCollections(data);
      setCollectionId((current) => current || data[0]?.id || "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load collections");
    }
  }, []);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  function selectRequest(request: SavedRequest) {
    setSavedId(request.id);
    setCollectionId(request.collectionId);
    setRequestName(request.name);
    setMethod(request.method as Method);
    setUrl(request.url);
    setQueryText(formatObject(request.queryParams ?? {}));
    setHeadersText(formatObject(request.headers ?? {}));
    setBearerToken("");
    setBody(request.body ?? "");
    setResponse(null);
    setNotice("Bearer tokens and sensitive authentication headers are never stored with saved requests.");
  }

  async function sendRequest() {
    setBusy(true);
    setNotice("");
    setResponse(null);
    try {
      const queryParams = JSON.parse(queryText) as unknown;
      const headers = JSON.parse(headersText) as unknown;
      const result = await fetch(`${api}/api/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method,
          url,
          queryParams,
          headers,
          bearerToken: bearerToken || undefined,
          body: body || undefined,
        }),
      });
      const data = (await result.json()) as ApiResponse | { error: string };
      if (!result.ok) throw new Error("error" in data ? data.error : "Request failed");
      setResponse(data as ApiResponse);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveRequest() {
    if (!collectionId) {
      setNotice("Create a collection before saving a request.");
      return;
    }
    try {
      const requestData = {
        name: requestName,
        method,
        url,
        queryParams: JSON.parse(queryText) as unknown,
        headers: JSON.parse(headersText) as unknown,
        body: body || null,
      };
      const editing = Boolean(savedId);
      const result = await fetch(
        editing ? `${api}/api/requests/${savedId}` : `${api}/api/collections/${collectionId}/requests`,
        {
          method: editing ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(requestData),
        },
      );
      if (!result.ok) {
        const data = (await result.json()) as { error?: string };
        throw new Error(data.error ?? "Could not save request");
      }
      const saved = (await result.json()) as SavedRequest;
      setSavedId(saved.id);
      setNotice("Request saved. Bearer tokens and sensitive authentication headers are not stored.");
      await loadCollections();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save request");
    }
  }

  async function createCollection() {
    const name = window.prompt("Collection name");
    if (!name?.trim()) return;
    try {
      const result = await fetch(`${api}/api/collections`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!result.ok) throw new Error("Could not create collection");
      const collection = (await result.json()) as Collection;
      setCollections((current) => [...current, collection]);
      setCollectionId(collection.id);
      setSavedId("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not create collection");
    }
  }

  async function deleteSavedRequest() {
    if (!savedId || !window.confirm("Delete this saved request?")) return;
    try {
      const result = await fetch(`${api}/api/requests/${savedId}`, { method: "DELETE" });
      if (!result.ok) throw new Error("Could not delete request");
      setSavedId("");
      await loadCollections();
      setNotice("Saved request deleted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete request");
    }
  }

  async function deleteCollection() {
    if (!collectionId || !window.confirm("Delete this collection and all its requests?")) return;
    try {
      const result = await fetch(`${api}/api/collections/${collectionId}`, { method: "DELETE" });
      if (!result.ok) throw new Error("Could not delete collection");
      setCollections((current) => current.filter((item) => item.id !== collectionId));
      setCollectionId("");
      setSavedId("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete collection");
    }
  }

  const selectedCollection = collections.find((item) => item.id === collectionId);

  return (
    <main className="shell">
      <header className="topbar">
        <Link className="brand" href="/">API<span>Forge</span></Link>
        <div className="local-badge"><i /> Local workspace</div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>COLLECTIONS</span>
            <button className="icon-button" onClick={createCollection} aria-label="Create collection">+</button>
          </div>
          {collections.length === 0 && <p className="muted sidebar-empty">Create a collection to save requests.</p>}
          {collections.map((collection) => (
            <section className="collection" key={collection.id}>
              <button className={`collection-title ${collection.id === collectionId ? "active" : ""}`} onClick={() => {
                setCollectionId(collection.id);
                setSavedId("");
              }}>
                <span>▾</span>{collection.name}
              </button>
              {(collection.requests ?? []).map((saved) => (
                <button className={`saved-request ${saved.id === savedId ? "chosen" : ""}`} key={saved.id} onClick={() => selectRequest(saved)}>
                  <span className={`method-tag ${saved.method.toLowerCase()}`}>{saved.method}</span>
                  <span className="saved-name">{saved.name}</span>
                </button>
              ))}
            </section>
          ))}
          {selectedCollection && <button className="text-button danger sidebar-delete" onClick={deleteCollection}>Delete collection</button>}
          <div className="sidebar-foot">APIForge <span>v1.0 · local only</span></div>
        </aside>

        <section className="content">
          <div className="page-heading">
            <div><div className="eyebrow">REQUEST WORKSPACE</div><h1>HTTP request</h1></div>
            <span className="secure-note">Outbound requests are restricted to public HTTP/HTTPS hosts.</span>
          </div>
          <div className="request-title-row">
            <input className="request-name" value={requestName} onChange={(event) => setRequestName(event.target.value)} aria-label="Request name" />
            <select value={collectionId} onChange={(event) => { setCollectionId(event.target.value); setSavedId(""); }} aria-label="Collection">
              <option value="">Choose collection</option>
              {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
            </select>
            <button className="button secondary" onClick={saveRequest}>Save</button>
            {savedId && <button className="button quiet" onClick={deleteSavedRequest}>Delete</button>}
          </div>

          <div className="url-bar">
            <select className={`method-select ${method.toLowerCase()}`} value={method} onChange={(event) => setMethod(event.target.value as Method)} aria-label="HTTP method">
              {methods.map((item) => <option key={item}>{item}</option>)}
            </select>
            <input className="url-input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://api.example.com/v1/resource" aria-label="Request URL" onKeyDown={(event) => { if (event.key === "Enter") void sendRequest(); }} />
            <button className="button primary send-button" onClick={() => void sendRequest()} disabled={busy || !url.trim()}>{busy ? "Sending…" : "Send"} <span>→</span></button>
          </div>

          <div className="fields-grid">
            <label className="field"><span>QUERY PARAMETERS <small>JSON object</small></span><textarea value={queryText} onChange={(event) => setQueryText(event.target.value)} spellCheck={false} /></label>
            <label className="field"><span>HEADERS <small>JSON object</small></span><textarea value={headersText} onChange={(event) => setHeadersText(event.target.value)} spellCheck={false} /></label>
          </div>
          <div className="fields-grid lower-fields">
            <label className="field"><span>BEARER TOKEN <small>optional · used for this request only</small></span><input type="password" value={bearerToken} onChange={(event) => setBearerToken(event.target.value)} placeholder="Paste token" autoComplete="off" /></label>
            <label className="field"><span>JSON BODY <small>optional</small></span><textarea className="body-input" value={body} onChange={(event) => setBody(event.target.value)} placeholder={'{\n  "key": "value"\n}'} spellCheck={false} /></label>
          </div>

          {notice && <div className="notice" role="status">{notice}</div>}
          <section className="response-panel">
            <div className="response-heading"><h2>Response</h2>{response && <div className="response-meta"><span className={`status-code ${response.status < 400 ? "success" : "failure"}`}>{response.status}</span><span>{response.durationMs} ms</span><span>{new Blob([response.body]).size} B</span></div>}</div>
            {response ? <>
              <details className="response-headers"><summary>Response headers</summary><pre>{formatObject(response.headers)}</pre></details>
              <pre className="response-body">{prettyBody(response.body) || <span className="muted">Empty response body</span>}</pre>
            </> : <div className="response-empty"><div className="response-icon">↗</div><strong>Ready when you are</strong><span>Send a request to see the response here.</span></div>}
          </section>
        </section>
      </div>
    </main>
  );
}
