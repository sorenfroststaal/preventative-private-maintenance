import { useState, type FormEvent } from "react";
import { login, type Archive, type PublicUser } from "@ppm/core";
import { errorText } from "../app/session";

interface Props {
  archive: Archive;
  users: PublicUser[];
  lastUserId: string | null;
  onLogin(u: PublicUser): void;
  onSwitchArchive(): void;
}

export function Login({ archive, users, lastUserId, onLogin, onSwitchArchive }: Props) {
  const [selected, setSelected] = useState<string>(
    users.find((u) => u.id === lastUserId)?.id ?? users[0]?.id ?? "",
  );
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const user = users.find((u) => u.id === selected);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    try {
      if (await login(archive.db, user.id, user.has_pin ? pin : null)) onLogin(user);
      else setError("Forkert PIN");
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <h1>Hvem bruger programmet?</h1>
        {archive.readOnly && (
          <p className="warning">Arkivet er lavet med en nyere version af programmet og er åbnet skrivebeskyttet.</p>
        )}
        <div className="user-list" role="radiogroup" aria-label="Bruger">
          {users.map((u) => (
            <label key={u.id} className={`user-choice ${u.id === selected ? "selected" : ""}`}>
              <input
                type="radio"
                name="user"
                value={u.id}
                checked={u.id === selected}
                onChange={() => {
                  setSelected(u.id);
                  setPin("");
                  setError(null);
                }}
              />
              {u.name}
              {u.is_admin ? <span className="badge">Admin</span> : null}
            </label>
          ))}
        </div>
        {user?.has_pin && (
          <label>
            PIN
            <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row">
          <button className="primary" type="submit" disabled={!user}>
            Fortsæt
          </button>
          <button type="button" onClick={onSwitchArchive}>
            Skift arkiv
          </button>
        </div>
        <p className="small muted">{archive.root}</p>
      </form>
    </div>
  );
}
