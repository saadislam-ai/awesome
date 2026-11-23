/**
 * Settings for the optional writing assistant. It is off until switched on
 * here, and it sends text only when one of its buttons is pressed.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, Sparkles } from 'lucide-react';
import { AssistantError, CLAUDE_MODELS, askAssistant, claudeModel, listOllamaModels, type AppSettings, type AssistantConfig } from '@borderless/core';
import { useStore } from '../state/store';
import { Field, Seg } from '../ui/kit';

/** What the assistant needs to reach its back end; the API key comes from the system keychain. */
export async function assistantConfig(): Promise<AssistantConfig> {
  const { host, settings } = useStore.getState();
  const key = settings.ai.provider === 'claude' ? ((await host.secrets?.get('claude-api-key')) ?? '') : '';
  return { provider: settings.ai.provider, ollamaUrl: settings.ai.ollamaUrl, ollamaModel: settings.ai.ollamaModel, claudeModel: settings.ai.claudeModel, claudeApiKey: key };
}

export function AssistantSettings() {
  const host = useStore((s) => s.host);
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const toast = useStore((s) => s.toast);
  const ai = settings.ai;
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [models, setModels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (patch: Partial<AppSettings['ai']>) => {
    setTestResult(null);
    void update({ ai: { ...ai, ...patch } });
  };
  useEffect(() => {
    void (host.secrets?.get('claude-api-key') ?? Promise.resolve(null)).then((k) => setHasKey(Boolean(k)), () => setHasKey(false));
  }, [host]);

  const say = (e: unknown) => (e instanceof AssistantError || e instanceof Error ? e.message : String(e));
  const saveKey = async () => {
    const key = keyDraft.trim();
    if (!key || !host.secrets) return;
    setBusy('key');
    try {
      const where = await host.secrets.set('claude-api-key', key);
      setKeyDraft('');
      setHasKey(true);
      toast('ok', where === 'keychain' ? 'The key is saved in the keychain of this computer.' : 'The key is saved in a private file in the app\'s data folder on this computer.');
    } catch (e) {
      toast('fail', say(e));
    } finally {
      setBusy('');
    }
  };
  const removeKey = async () => {
    await host.secrets?.remove('claude-api-key').catch((e) => toast('fail', say(e)));
    setHasKey(false);
    setTestResult(null);
  };
  const findModels = async () => {
    setBusy('models');
    try {
      const list = await listOllamaModels(host, ai.ollamaUrl);
      setModels(list);
      if (list.length && !list.includes(ai.ollamaModel)) set({ ollamaModel: list[0] });
      if (list.length === 0) toast('info', 'Ollama is running but has no models yet. Install one in a terminal, for example: ollama pull llama3.2');
    } catch (e) {
      setModels(null);
      toast('fail', say(e));
    } finally {
      setBusy('');
    }
  };
  const test = async () => {
    setBusy('test');
    setTestResult(null);
    try {
      const reply = await askAssistant(host, await assistantConfig(), { system: 'This is a connection test from a writing app.', user: 'Reply with the single word: ready' });
      setTestResult({ ok: true, text: `It works. ${reply.model} answered: ${reply.text.trim().slice(0, 60)}` });
    } catch (e) {
      setTestResult({ ok: false, text: say(e) });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="card">
      <div className="row">
        <Sparkles size={18} className="dim" />
        <h2 className="grow" style={{ margin: 0 }}>Writing assistant</h2>
        <span className="badge">optional</span>
        <label className="check"><input type="checkbox" checked={ai.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Switched on</label>
      </div>
      <p className="dim small" style={{ marginTop: 6 }}>
        The assistant can proofread, tighten or smooth a passage you select, or answer a question about it. It never changes your text by itself: its proposals arrive as tracked changes that you accept or reject one by one. While it is switched off, the app makes no contact with any service.
      </p>
      {ai.enabled && (
        <>
          <Seg value={ai.provider} onChange={(provider) => set({ provider })} options={[
            { value: 'ollama', label: 'A model on this computer (Ollama)', title: 'Free and private: the text stays on this computer' },
            { value: 'claude', label: 'Claude (online, your own API key)', title: 'Better at prose; the selected text is sent to Anthropic' },
          ]} />
          {ai.provider === 'ollama' && (
            <div style={{ marginTop: 12 }}>
              <p className="small dim">Ollama is a free program that runs language models on your own computer (ollama.com). The selected text goes to that program and nowhere else. Quality and speed depend on the model and on your computer; small models make more mistakes than Claude.</p>
              <div className="grid2">
                <Field label="Address of Ollama" hint="Leave as it is unless you changed Ollama's port. Only addresses on this computer are accepted.">
                  <input className="input" value={ai.ollamaUrl} onChange={(e) => set({ ollamaUrl: e.target.value })} />
                </Field>
                <Field label="Model">
                  <div className="row">
                    {models && models.length > 0
                      ? <select className="select" value={ai.ollamaModel} onChange={(e) => set({ ollamaModel: e.target.value })}>{models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                      : <input className="input" value={ai.ollamaModel} placeholder="llama3.2" onChange={(e) => set({ ollamaModel: e.target.value })} />}
                    <button className="btn" disabled={busy !== ''} onClick={() => void findModels()}>{busy === 'models' ? <Loader2 size={14} className="spin" /> : null} Find installed models</button>
                  </div>
                </Field>
              </div>
            </div>
          )}
          {ai.provider === 'claude' && (
            <div style={{ marginTop: 12 }}>
              <p className="small dim">
                Each time you press an assistant button, the passage you selected, your instruction and the book's house style are sent over the internet to Anthropic's API, under your own account and its terms. Nothing else from the book is sent. You pay Anthropic for what you use; a page of text costs a fraction of a cent to a few cents, depending on the model.
              </p>
              <div className="grid2">
                <Field label="Model" hint={CLAUDE_MODELS.find((m) => m.id === claudeModel(ai.claudeModel))?.note}>
                  <select className="select" value={claudeModel(ai.claudeModel)} onChange={(e) => set({ claudeModel: e.target.value })}>
                    {CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </Field>
                <Field label="API key" hint="Make a key in the Anthropic Console (console.anthropic.com). It is kept in the keychain of this computer, not in any book or settings file.">
                  {hasKey ? (
                    <div className="row"><span className="badge ok"><KeyRound size={12} /> A key is saved</span><button className="btn small" onClick={() => void removeKey()}>Remove the key</button></div>
                  ) : (
                    <div className="row">
                      <input className="input" type="password" autoComplete="off" value={keyDraft} placeholder="sk-ant-..." onChange={(e) => setKeyDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void saveKey(); }} />
                      <button className="btn" disabled={!keyDraft.trim() || busy !== '' || !host.secrets} onClick={() => void saveKey()}>Save</button>
                    </div>
                  )}
                </Field>
              </div>
              <p className="small faint" style={{ marginTop: 8 }}>If a model wrongly declines an ordinary request, Anthropic's API may hand it to another Claude model so that you still get an answer.</p>
            </div>
          )}
          <div className="row wrap" style={{ marginTop: 12 }}>
            <button className="btn" disabled={busy !== '' || (ai.provider === 'claude' && !hasKey)} onClick={() => void test()}>{busy === 'test' ? <Loader2 size={14} className="spin" /> : null} Test the connection</button>
            {testResult && <span className={`small ${testResult.ok ? '' : 'selectable'}`} style={{ color: testResult.ok ? 'var(--ok)' : 'var(--fail)' }}>{testResult.ok && <CheckCircle2 size={13} style={{ verticalAlign: -2 }} />} {testResult.text}</span>}
          </div>
        </>
      )}
    </div>
  );
}
