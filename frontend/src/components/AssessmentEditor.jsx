import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Save } from 'lucide-react';
import { api } from '../lib/api';

function answersFromAssessment(template, assessment) {
  const existing = new Map((assessment?.answers || []).map((item) => [item.question_id, item]));
  return (template?.questions || []).map((question) => ({
    question_id: question.id,
    score: existing.get(question.id)?.score ?? 0,
    note: existing.get(question.id)?.note || '',
    evidence: existing.get(question.id)?.evidence || '',
  }));
}

export default function AssessmentEditor({ diagnosisId, section, template, assessment, scoreOptions, onSaved }) {
  const [answers, setAnswers] = useState(() => answersFromAssessment(template, assessment));
  const [notes, setNotes] = useState(assessment?.notes || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setAnswers(answersFromAssessment(template, assessment));
    setNotes(assessment?.notes || '');
  }, [assessment?.id, section]);

  const preview = useMemo(() => {
    const questions = template?.questions || [];
    const map = new Map(answers.map((item) => [item.question_id, item]));
    const max = questions.reduce((sum, question) => sum + 4 * (question.weight || 1), 0);
    const earned = questions.reduce((sum, question) => sum + (map.get(question.id)?.score || 0) * (question.weight || 1), 0);
    return max ? Math.round((earned / max) * 100) : 0;
  }, [answers, template]);

  const updateAnswer = (questionId, patch) => {
    setAnswers((items) => items.map((item) => item.question_id === questionId ? { ...item, ...patch } : item));
    setMessage('');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api(`/api/diagnose/${diagnosisId}/assessments/${section}`, {
        method: 'PUT',
        body: JSON.stringify({ answers, notes }),
      });
      setMessage(`Evaluación guardada · ${result.assessment.score}/100`);
      onSaved?.(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="assessment-editor">
      <header className="assessment-header">
        <div><p className="eyebrow">EVALUACIÓN</p><h2>{template.title}</h2><p>{template.description}</p></div>
        <div className="assessment-live-score"><span>Score estimado</span><strong>{preview}</strong><small>de 100</small></div>
      </header>

      {error && <div className="form-error">{error}</div>}
      {message && <div className="diagnose-success"><CheckCircle2 size={17} />{message}</div>}

      <div className="assessment-question-list">
        {template.questions.map((question, index) => {
          const answer = answers.find((item) => item.question_id === question.id) || { score: 0, note: '', evidence: '' };
          return (
            <article className="assessment-question" key={question.id}>
              <div className="assessment-question-copy">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><h3>{question.label}</h3><p>{question.description}</p><small>Peso {question.weight}</small></div>
              </div>
              <div className="assessment-answer-controls">
                <label>Nivel<select value={answer.score} onChange={(e) => updateAnswer(question.id, { score: Number(e.target.value) })}>{scoreOptions.map((option) => <option key={option.value} value={option.value}>{option.value} · {option.label}</option>)}</select></label>
                <label>Nota<input value={answer.note} onChange={(e) => updateAnswer(question.id, { note: e.target.value })} placeholder="Observación concreta" /></label>
                <label>Evidencia<input value={answer.evidence} onChange={(e) => updateAnswer(question.id, { evidence: e.target.value })} placeholder="Captura, dato o ejemplo" /></label>
              </div>
            </article>
          );
        })}
      </div>

      <label>Notas generales<textarea rows="4" value={notes} onChange={(e) => { setNotes(e.target.value); setMessage(''); }} placeholder="Contexto adicional de esta evaluación" /></label>
      <div className="assessment-savebar"><button className="button diagnose-primary" onClick={save} disabled={saving}><Save size={17} />{saving ? 'Guardando…' : 'Guardar evaluación'}</button></div>
    </section>
  );
}
