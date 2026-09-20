import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { FormValidationService } from './form-validation.service.js';

const validation = new FormValidationService();
const fields = [
  { key: 'title', label: 'Título', type: 'SHORT_TEXT' as const, required: true, options: [] },
  { key: 'severity', label: 'Severidade', type: 'SELECT' as const, required: true, options: ['Baixa', 'Alta'] },
  { key: 'tags', label: 'Etiquetas', type: 'MULTI_SELECT' as const, required: false, options: ['A', 'B'] },
  { key: 'date', label: 'Data', type: 'DATE' as const, required: false, options: [] }
];

describe('FormValidationService', () => {
  it('rejects malformed builders before they reach persistence', () => {
    expect(() => validation.parseFields([{ key: 'invalid key', label: 'X', type: 'SHORT_TEXT' }])).toThrow(BadRequestException);
    expect(() => validation.parseFields([{ key: 'same', label: 'A', type: 'SHORT_TEXT' }, { key: 'same', label: 'B', type: 'SHORT_TEXT' }])).toThrow(BadRequestException);
    expect(() => validation.parseFields([{ key: 'choice', label: 'Escolha', type: 'SELECT', options: [] }])).toThrow('Campos de seleção exigem ao menos uma opção.');
  });

  it('accepts valid answers and rejects missing, forged and mistyped values', () => {
    expect(validation.validateAnswers(fields, { title: 'Inspeção', severity: 'Alta', tags: ['A', 'B'], date: '2026-09-20' })).toEqual({ title: 'Inspeção', severity: 'Alta', tags: ['A', 'B'], date: '2026-09-20' });
    expect(() => validation.validateAnswers(fields, { severity: 'Alta' })).toThrow("O campo 'Título' é obrigatório.");
    expect(() => validation.validateAnswers(fields, { title: 'Inspeção', severity: 'Crítica' })).toThrow('não é uma opção permitida');
    expect(() => validation.validateAnswers(fields, { title: 'Inspeção', severity: 'Alta', date: '2026-02-30' })).toThrow('deve ser uma data ISO');
    expect(() => validation.validateAnswers(fields, { title: 'Inspeção', severity: 'Alta', privileged: true })).toThrow("não pertence a este formulário");
  });
});
