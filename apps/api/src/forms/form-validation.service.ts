import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';

export const formFieldTypes = ['SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTI_SELECT', 'CHECKBOX'] as const;
export const formStatuses = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export const formSubmissionStatuses = ['RECEIVED', 'IN_REVIEW', 'RESOLVED', 'REJECTED'] as const;

export type FormFieldInput = {
  key: string;
  label: string;
  type: typeof formFieldTypes[number];
  required: boolean;
  options: string[];
};

const fieldInputSchema = z.object({
  key: z.string().trim().toLowerCase().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/, 'Use letras minúsculas, números e underscore no identificador do campo.'),
  label: z.string().trim().min(1).max(160),
  type: z.enum(formFieldTypes),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(160)).max(100).default([])
}).superRefine((field, context) => {
  const selectable = field.type === 'SELECT' || field.type === 'MULTI_SELECT';
  if (selectable && field.options.length === 0) context.addIssue({ code: 'custom', path: ['options'], message: 'Campos de seleção exigem ao menos uma opção.' });
  if (!selectable && field.options.length > 0) context.addIssue({ code: 'custom', path: ['options'], message: 'Opções são permitidas somente em campos de seleção.' });
  if (new Set(field.options).size !== field.options.length) context.addIssue({ code: 'custom', path: ['options'], message: 'As opções do campo devem ser únicas.' });
});

export const formFieldsSchema = z.array(fieldInputSchema).min(1).max(100).superRefine((fields, context) => {
  const keys = fields.map((field) => field.key);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', message: 'Os identificadores dos campos devem ser únicos.' });
});

export type StoredField = FormFieldInput;

@Injectable()
export class FormValidationService {
  public parseFields(input: unknown): FormFieldInput[] {
    const parsed = formFieldsSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Campos inválidos.');
    return parsed.data;
  }

  public validateAnswers(fields: StoredField[], input: unknown): Record<string, unknown> {
    const parsed = z.record(z.string(), z.unknown()).safeParse(input);
    if (!parsed.success) throw new BadRequestException('As respostas precisam ser um objeto.');
    const answers = parsed.data;
    const byKey = new Map(fields.map((field) => [field.key, field]));
    for (const key of Object.keys(answers)) {
      if (!byKey.has(key)) throw new BadRequestException(`O campo '${key}' não pertence a este formulário.`);
    }
    for (const field of fields) {
      const value = answers[field.key];
      if (value === undefined || value === null || value === '') {
        if (field.required) throw new BadRequestException(`O campo '${field.label}' é obrigatório.`);
        continue;
      }
      this.assertAnswerType(field, value);
    }
    return answers;
  }

  private assertAnswerType(field: StoredField, value: unknown): void {
    if (field.type === 'SHORT_TEXT' || field.type === 'LONG_TEXT') {
      if (typeof value !== 'string' || value.trim().length === 0 || value.length > 10_000) throw new BadRequestException(`A resposta de '${field.label}' deve ser um texto válido.`);
      return;
    }
    if (field.type === 'NUMBER') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new BadRequestException(`A resposta de '${field.label}' deve ser numérica.`);
      return;
    }
    if (field.type === 'DATE') {
      if (typeof value !== 'string' || !this.isIsoDate(value)) throw new BadRequestException(`A resposta de '${field.label}' deve ser uma data ISO.`);
      return;
    }
    if (field.type === 'CHECKBOX') {
      if (typeof value !== 'boolean') throw new BadRequestException(`A resposta de '${field.label}' deve ser verdadeira ou falsa.`);
      return;
    }
    if (field.type === 'SELECT') {
      if (typeof value !== 'string' || !field.options.includes(value)) throw new BadRequestException(`A resposta de '${field.label}' não é uma opção permitida.`);
      return;
    }
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !field.options.includes(item)) || new Set(value).size !== value.length) {
      throw new BadRequestException(`A resposta de '${field.label}' contém opções inválidas.`);
    }
  }

  private isIsoDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1] ?? Number.NaN);
    const month = Number(match[2] ?? Number.NaN);
    const day = Number(match[3] ?? Number.NaN);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
}
