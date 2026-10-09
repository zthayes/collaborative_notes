import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { api } from "./api";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:3000";

function Auth({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");

    try {
      const data = await api(`/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        body: JSON.stringify(form)
      });

      localStorage.setItem("token", data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="auth">
      <form onSubmit={submit} className="card auth-card">
        <h1>Collaborative Notes</h1>

        {mode === "register" && (
          <input
            placeholder="Name"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
          />
        )}

        <input
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={e => setForm({ ...form, email: e.target.value })}
        />

        <input
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={e => setForm({ ...form, password: e.target.value })}
        />

        {error && <p className="error">{error}</p>}

        <button type="submit">
          {mode === "login" ? "Sign in" : "Create account"}
        </button>

        <button
          type="button"
          className="secondary"
          onClick={() => setMode(mode === "login" ? "register" : "login")}
        >
          {mode === "login" ? "Create an account" : "Back to sign in"}
        </button>
      </form>
    </main>
  );
}

function ShareModal({ note, onClose }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [shares, setShares] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);

  async function loadShares() {
    try {
      const data = await api(`/notes/${note.id}/shares`);
      setShares(data.shares);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadShares();
  }, [note.id]);

  async function share() {
    if (!email.trim()) return;

    setSharing(true);
    setError("");

    try {
      const data = await api(`/notes/${note.id}/share`, {
        method: "POST",
        body: JSON.stringify({
          email: email.trim(),
          role
        })
      });

      setShares(current => {
        const withoutExisting = current.filter(
          share => share.user_id !== data.share.user_id
        );
        return [...withoutExisting, data.share].sort((a, b) =>
          a.user.name.localeCompare(b.user.name)
        );
      });
      setEmail("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSharing(false);
    }
  }

  async function removeShare(userId) {
    setError("");

    try {
      await api(`/notes/${note.id}/share/${userId}`, { method: "DELETE" });
      setShares(current => current.filter(share => share.user_id !== userId));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="share-modal card" onMouseDown={e => e.stopPropagation()}>
        <div className="share-header">
          <div>
            <h2>Share note</h2>
            <p>{note.title}</p>
          </div>
          <button className="icon-button secondary" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="share-form">
          <label>
            User email
            <input
              type="email"
              placeholder="person@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") share();
              }}
            />
          </label>

          <label>
            Permission
            <select value={role} onChange={e => setRole(e.target.value)}>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>

          <button onClick={share} disabled={sharing || !email.trim()}>
            {sharing ? "Sharing..." : "Share"}
          </button>
        </div>

        {error && <p className="error share-error">{error}</p>}

        <div className="shared-list">
          <h3>People with access</h3>
          {loading ? (
            <p className="muted">Loading...</p>
          ) : shares.length === 0 ? (
            <p className="muted">This note isn't shared with anyone yet.</p>
          ) : (
            shares.map(share => (
              <div className="shared-user" key={share.user_id}>
                <div>
                  <strong>{share.user.name}</strong>
                  <span>{share.user.email}</span>
                </div>
                <div className="shared-user-actions">
                  <span className="role-badge">{share.role}</span>
                  <button
                    className="remove-share"
                    onClick={() => removeShare(share.user_id)}
                    aria-label={`Remove ${share.user.name}`}
                    title="Remove access"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!localStorage.getItem("token")) return;

    api("/auth/me")
      .then(data => setUser(data.user))
      .catch(() => localStorage.removeItem("token"));
  }, []);

  if (!user) {
    return <Auth onLogin={setUser} />;
  }

  return (
    <NotesApp
      user={user}
      logout={() => {
        localStorage.removeItem("token");
        setUser(null);
      }}
    />
  );
}

function NotesApp({ user, logout }) {
  const [notes, setNotes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [shareOpen, setShareOpen] = useState(false);

  const socket = useMemo(() => {
    return io(SOCKET_URL, {
      autoConnect: false,
      auth: { token: localStorage.getItem("token") }
    });
  }, []);

  async function loadNotes() {
    const data = await api(`/notes?search=${encodeURIComponent(search)}`);
    setNotes(data.notes);

    if (!selectedId && data.notes[0]) {
      setSelectedId(data.notes[0].id);
    }
  }

  useEffect(() => {
    loadNotes().catch(err => setStatus(err.message));
  }, [search]);

  useEffect(() => {
    if (!selectedId) {
      setDraft(null);
      setShareOpen(false);
      return;
    }

    setShareOpen(false);

    api(`/notes/${selectedId}`)
      .then(data => setDraft(data.note))
      .catch(err => setStatus(err.message));

    socket.connect();

    socket.emit("note:join", selectedId, result => {
      if (result?.ok) {
        setDraft(result.note);
      }
    });

    const handleUpdate = note => {
      if (note.id === selectedId) {
        // The broadcast payload is based on the user who saved the note.
        // Preserve this client's access role so an editor does not appear
        // to become the owner (or lose owner-only controls) when another
        // user saves the shared note.
        setDraft(current => current ? { ...note, role: current.role } : note);
        setNotes(current =>
          current.map(item =>
            item.id === note.id ? { ...item, ...note, role: item.role } : item
          )
        );
        setStatus("Updated by another user");
      }
    };

    socket.on("note:updated", handleUpdate);

    return () => {
      socket.emit("note:leave", selectedId);
      socket.off("note:updated", handleUpdate);
      socket.disconnect();
    };
  }, [selectedId, socket]);

  async function createNote() {
    const data = await api("/notes", {
      method: "POST",
      body: JSON.stringify({
        title: "Untitled note",
        content: ""
      })
    });

    setNotes(current => [data.note, ...current]);
    setSelectedId(data.note.id);
  }

  async function saveNote() {
    if (!draft || draft.role === "viewer") return;

    try {
      const data = await api(`/notes/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: draft.title,
          content: draft.content,
          revision: draft.revision
        })
      });

      setDraft(data.note);
      setNotes(current =>
        current.map(note => note.id === data.note.id ? data.note : note)
      );
      setStatus("Saved");

      socket.emit("note:join", draft.id, () => {});
      socket.emit("note:updated", data.note);
    } catch (err) {
      if (err.status === 409) {
        setDraft(err.data.note);
        setStatus("Conflict detected. Loaded the latest version.");
      } else {
        setStatus(err.message);
      }
    }
  }

  async function deleteCurrent() {
    if (!draft || draft.role !== "owner") return;

    await api(`/notes/${draft.id}`, { method: "DELETE" });
    const remaining = notes.filter(note => note.id !== draft.id);
    setNotes(remaining);
    setSelectedId(remaining[0]?.id ?? null);
    setDraft(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>Collaborative Notes</strong>
        <span>{user.name}</span>
        <button className="secondary" onClick={logout}>Sign out</button>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-actions">
            <button onClick={createNote}>+ New note</button>
            <input
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {notes.map(note => (
            <button
              key={note.id}
              className={`note-item ${selectedId === note.id ? "selected" : ""}`}
              onClick={() => setSelectedId(note.id)}
            >
              <strong>{note.title}</strong>
              <small>{note.role}</small>
            </button>
          ))}
        </aside>

        <section className="editor">
          {!draft ? (
            <div className="empty">
              <h2>Select a note</h2>
              <p>Create a note or select one from the sidebar.</p>
            </div>
          ) : (
            <>
              <div className="editor-toolbar">
                <span>
                  {draft.role === "viewer" ? "View only" : "Editing"}
                  {status && ` · ${status}`}
                </span>
                <div className="toolbar-actions">
                  {draft.role === "owner" && (
                    <button className="secondary" onClick={() => setShareOpen(true)}>
                      Share
                    </button>
                  )}
                  {draft.role !== "viewer" && (
                    <button onClick={saveNote}>Save</button>
                  )}
                  {draft.role === "owner" && (
                    <button className="danger" onClick={deleteCurrent}>
                      Delete
                    </button>
                  )}
                </div>
              </div>

              <input
                className="title-input"
                value={draft.title}
                disabled={draft.role === "viewer"}
                onChange={e => setDraft({ ...draft, title: e.target.value })}
              />

              <textarea
                className="content-input"
                value={draft.content}
                disabled={draft.role === "viewer"}
                onChange={e => setDraft({ ...draft, content: e.target.value })}
                placeholder="Start writing..."
              />

              <footer className="revision">
                Revision {draft.revision} · {draft.role}
              </footer>
            </>
          )}
        </section>
      </div>

      {shareOpen && draft?.role === "owner" && (
        <ShareModal note={draft} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}

export default App;
