import { useState, type FormEvent } from "react";
import { createUser, listUsers, makeCtx, type Archive, type Env, type PublicUser } from "@ppm/core";
import { errorText } from "../app/session";
import { PinFields, validatePin } from "../components/PinFields";

export function FirstUser({ env, archive, onDone }: { env: Env; archive: Archive; onDone(u: PublicUser): void }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const pinError = validatePin(pin, pin2);
    if (pinError) return setError(pinError);
    setBusy(true);
    try {
      const { user } = await createUser(makeCtx(env, archive.db, null, "ui"), {
        name: name.trim(),
        pin: pin || null,
        isAdmin: true,
      });
      const users = await listUsers(archive.db);
      onDone(users.find((u) => u.id === user.id)!);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <h1>Opret den første bruger</h1>
        <p className="muted">Den første bruger bliver administrator og kan senere oprette flere brugere.</p>
        <label>
          Navn
          <input autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <PinFields pin={pin} pin2={pin2} onPin={setPin} onPin2={setPin2} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy || !name.trim()}>
          Opret bruger
        </button>
      </form>
    </div>
  );
}
