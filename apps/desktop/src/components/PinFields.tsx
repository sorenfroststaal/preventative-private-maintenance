export function validatePin(pin: string, pin2: string): string | null {
  if (!pin && !pin2) return null;
  if (!/^\d{4,8}$/.test(pin)) return "PIN skal være 4-8 cifre";
  if (pin !== pin2) return "De to PIN-koder er ikke ens";
  return null;
}

export function PinFields(props: { pin: string; pin2: string; onPin(v: string): void; onPin2(v: string): void }) {
  return (
    <fieldset>
      <legend>PIN (valgfri)</legend>
      <p className="small muted">
        En PIN forhindrer, at andre i husstanden kommer til at bruge din profil. Den er ikke en sikkerhedsgrænse,
        fordi arkivet ikke er krypteret.
      </p>
      <div className="row">
        <label>
          PIN
          <input type="password" inputMode="numeric" autoComplete="new-password" value={props.pin} onChange={(e) => props.onPin(e.target.value)} />
        </label>
        <label>
          Gentag PIN
          <input type="password" inputMode="numeric" autoComplete="new-password" value={props.pin2} onChange={(e) => props.onPin2(e.target.value)} />
        </label>
      </div>
    </fieldset>
  );
}
