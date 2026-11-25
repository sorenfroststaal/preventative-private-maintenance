import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyOnboarding, finishOnboarding, onboardingSuggestions, shouldOfferOnboarding, type OnboardingAnswers } from "@ppm/core";
import { errorText, useSession } from "../app/session";
import { useToast } from "../layout/Shell";
import { Modal } from "./ui";
import { TEMPLATES } from "../lib/templates";

const START: OnboardingAnswers = { propertyKind: "house", owned: true, woodStove: false, rainwaterWell: false, heatPump: false, car: false, children: false };

/** Phase 4.6: offered on Overblik in a new archive; can be skipped and opened again from Indstillinger. */
export function OnboardingOffer() {
  const session = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["onboarding", "offer"], queryFn: () => shouldOfferOnboarding(session.archive.db) });
  const skip = useMutation({
    mutationFn: () => finishOnboarding(session.ctx()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding"] }),
  });
  if (!q.data || session.archive.readOnly) return null;
  return (
    <div className="panel module" style={{ ["--mc" as string]: "var(--c-tasks)" }} role="region" aria-label="Kom godt i gang">
      <h2>Kom godt i gang</h2>
      <p>Svar på et par spørgsmål om bolig, bil og børn, så foreslår appen opgaver, du kan vælge til og fra.</p>
      <div className="row">
        <button className="primary" onClick={() => setOpen(true)}>
          Start guiden
        </button>
        <button onClick={() => skip.mutate()}>Spring over</button>
      </div>
      <p className="small muted">Guiden kan åbnes igen under Indstillinger.</p>
      {open && <OnboardingDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function YesNo({ label, value, onChange, name }: { label: string; value: boolean; onChange(v: boolean): void; name: string }) {
  return (
    <fieldset className="yesno">
      <legend>{label}</legend>
      <label className="inline">
        <input type="radio" name={name} checked={value} onChange={() => onChange(true)} /> Ja
      </label>
      <label className="inline">
        <input type="radio" name={name} checked={!value} onChange={() => onChange(false)} /> Nej
      </label>
    </fieldset>
  );
}

export function OnboardingDialog({ onClose }: { onClose(): void }) {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [a, setA] = useState<OnboardingAnswers>(START);
  const suggestions = onboardingSuggestions(a, TEMPLATES);
  const [chosen, setChosen] = useState<string[]>([]);
  const set = <K extends keyof OnboardingAnswers>(k: K, v: OnboardingAnswers[K]) => setA((x) => ({ ...x, [k]: v }));
  const apply = useMutation({
    mutationFn: () => applyOnboarding(session.ctx(), a, chosen, TEMPLATES),
    onSuccess: async (r) => {
      toast(`${r.created} ${r.created === 1 ? "opgave er" : "opgaver er"} oprettet${r.skipped ? `, ${r.skipped} fandtes allerede` : ""}`);
      await qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast(errorText(e), "error"),
  });
  const skip = useMutation({
    mutationFn: () => finishOnboarding(session.ctx()),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["onboarding"] });
      onClose();
    },
  });
  const home = a.propertyKind !== "none";
  return (
    <Modal title="Opstartsguide" onClose={onClose} wide>
      {step === 1 ? (
        <div>
          <label>
            Hvor bor I?
            <select value={a.propertyKind} onChange={(e) => set("propertyKind", e.target.value as OnboardingAnswers["propertyKind"])}>
              <option value="house">Hus</option>
              <option value="apartment">Lejlighed</option>
              <option value="summerhouse">Sommerhus</option>
              <option value="other">Andet</option>
              <option value="none">Spring boligen over</option>
            </select>
          </label>
          {home && (
            <>
              <fieldset className="yesno">
                <legend>Ejer eller lejer I boligen?</legend>
                <label className="inline">
                  <input type="radio" name="owned" checked={a.owned} onChange={() => set("owned", true)} /> Ejer
                </label>
                <label className="inline">
                  <input type="radio" name="owned" checked={!a.owned} onChange={() => set("owned", false)} /> Lejer
                </label>
              </fieldset>
              <YesNo name="woodStove" label="Har I brændeovn?" value={a.woodStove} onChange={(v) => set("woodStove", v)} />
              <YesNo name="rainwaterWell" label="Har I regnvandsbrønd?" value={a.rainwaterWell} onChange={(v) => set("rainwaterWell", v)} />
              <YesNo name="heatPump" label="Har I varmepumpe?" value={a.heatPump} onChange={(v) => set("heatPump", v)} />
            </>
          )}
          <YesNo name="car" label="Har I bil?" value={a.car} onChange={(v) => set("car", v)} />
          <YesNo name="children" label="Har I børn?" value={a.children} onChange={(v) => set("children", v)} />
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                setChosen(suggestions.filter((s) => s.selected).map((s) => s.template_id));
                setStep(2);
              }}
            >
              Vis forslag
            </button>
            <button onClick={() => skip.mutate()}>Spring over</button>
          </div>
        </div>
      ) : (
        <div>
          <p className="small muted">Vælg de opgaver, du vil have. Datoer og intervaller kan rettes bagefter under Opgaver.</p>
          <ul className="plain" aria-label="Foreslåede opgaver">
            {suggestions.map((s) => (
              <li key={s.template_id} className="line">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={chosen.includes(s.template_id)}
                    onChange={(e) => setChosen(e.target.checked ? [...chosen, s.template_id] : chosen.filter((x) => x !== s.template_id))}
                  />{" "}
                  {s.title}
                </label>
                <span className="small muted">{s.reason}</span>
              </li>
            ))}
          </ul>
          <div className="row">
            <button className="primary" onClick={() => apply.mutate()} disabled={chosen.length === 0 || apply.isPending}>
              Opret {chosen.length} {chosen.length === 1 ? "opgave" : "opgaver"}
            </button>
            <button onClick={() => setStep(1)}>Tilbage</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
