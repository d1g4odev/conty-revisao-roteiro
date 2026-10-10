# Revisão de roteiro

API HTTP para revisão de roteiros entre criador e marca: versões com estado explícito, pedidos de ajuste com motivo e prazo, aprovação que encerra a revisão.

Stack: Node 22.18+ (roda TypeScript direto, sem build), Fastify 5, Zod 4, Vitest, TypeScript estrito. Armazenamento em memória.

## Como rodar

```bash
npm install
npm start            # http://127.0.0.1:3000 (PORT e HOST configuráveis)
npm test             # 29 testes
npm run typecheck
```

## Estados

```
            POST /change-requests            POST /versions
 in_review ───────────────────────▶ changes_requested ───────▶ in_review
     │                                                       (nova versão)
     │ POST /approve
     ▼
  approved  (terminal: qualquer escrita devolve 409 revision_closed)
```

- `in_review`: a marca avalia a versão atual. Pode pedir ajuste ou aprovar.
- `changes_requested`: há um pedido aberto. Só o envio de nova versão é aceito; aprovar ou pedir outro ajuste dá 409.
- `approved`: guarda `approvedVersion` e `approvedAt`. Não reabre.

Versões são append-only: cada envio cria `number + 1` e as anteriores ficam intactas em `versions`. Cada pedido registra a versão que motivou (`versionNumber`) e a versão que o resolveu (`resolvedByVersion`).

## Prazo

`deadline` é um dia de calendário (`YYYY-MM-DD`) em `America/Sao_Paulo`. O pedido é válido enquanto a data local de São Paulo no momento da requisição for `<= deadline`, então `23:59:59.999` do dia ainda vale e `00:00:00.000` do dia seguinte já expira. A conversão usa `Intl` com a base de fusos do Node, então respeita o horário de verão histórico (há teste para dezembro de 2018, UTC-2).

Pedido com prazo vencido é recusado com `422 deadline_expired` e não altera o roteiro.

O relógio é injetado (`Clock`); os testes usam `ManualClock` para fixar o instante exato:

- `2026-10-15T23:59:59.999-03:00` com prazo `2026-10-15` → 201
- `2026-10-16T00:00:00.000-03:00` com prazo `2026-10-15` → 422

## Endpoints

| Método | Rota | Corpo | Sucesso |
| --- | --- | --- | --- |
| POST | `/scripts` | `{ title, content }` | 201 roteiro |
| GET | `/scripts/:id` | | 200 roteiro |
| GET | `/scripts/:id/versions` | | 200 lista de versões |
| GET | `/scripts/:id/versions/:number` | | 200 versão |
| POST | `/scripts/:id/change-requests` | `{ reason, deadline }` | 201 roteiro |
| POST | `/scripts/:id/versions` | `{ content }` | 201 roteiro |
| POST | `/scripts/:id/approve` | | 200 roteiro |

Erros: `{ "error": "<code>", "message": "..." }`. `400` corpo inválido, motivo vazio ou data malformada; `404` roteiro/versão inexistente; `409` transição inválida ou revisão encerrada; `422` prazo vencido. A checagem de estado vem antes da de prazo.

## Exemplos (saídas reais do servidor)

Criar:

```bash
curl -X POST localhost:3000/scripts -H 'content-type: application/json' \
  -d '{"title":"Unboxing fone X","content":"Hook + produto + CTA"}'
```

```json
{"id":"94c52c3f-41d0-4978-9220-7054e22dde24","title":"Unboxing fone X","status":"in_review","currentVersion":1,
 "versions":[{"number":1,"content":"Hook + produto + CTA","createdAt":"2026-10-10T06:06:20.437Z"}],
 "changeRequests":[],"approvedVersion":null,"approvedAt":null,
 "createdAt":"2026-10-10T06:06:20.437Z","updatedAt":"2026-10-10T06:06:20.437Z"}
```

Pedir ajuste:

```bash
curl -X POST localhost:3000/scripts/$ID/change-requests -H 'content-type: application/json' \
  -d '{"reason":"Citar o cupom CONTY10","deadline":"2026-10-15"}'
```

```json
{"id":"94c52c3f-...","status":"changes_requested","currentVersion":1,
 "changeRequests":[{"id":"8976d0a4-...","versionNumber":1,"reason":"Citar o cupom CONTY10",
   "deadline":"2026-10-15","requestedAt":"2026-10-10T06:06:20.471Z","resolvedByVersion":null}], "...": "..."}
```

Prazo vencido (`deadline` anterior ao dia atual em São Paulo) → `422`:

```json
{"error":"deadline_expired","message":"deadline 2026-10-15 has already passed in America/Sao_Paulo"}
```

Enviar nova versão:

```bash
curl -X POST localhost:3000/scripts/$ID/versions -H 'content-type: application/json' \
  -d '{"content":"Hook + produto + cupom CONTY10 + CTA"}'
```

```json
{"id":"94c52c3f-...","status":"in_review","currentVersion":2,
 "versions":[{"number":1,"content":"Hook + produto + CTA","createdAt":"2026-10-10T06:06:20.437Z"},
             {"number":2,"content":"Hook + produto + cupom CONTY10 + CTA","createdAt":"2026-10-10T06:06:20.486Z"}],
 "changeRequests":[{"id":"8976d0a4-...","versionNumber":1,"resolvedByVersion":2, "...": "..."}], "...": "..."}
```

Aprovar:

```bash
curl -X POST localhost:3000/scripts/$ID/approve
```

```json
{"id":"94c52c3f-...","status":"approved","currentVersion":2,"approvedVersion":2,
 "approvedAt":"2026-10-10T06:06:20.493Z", "...": "..."}
```

Tentar reabrir → `409`:

```json
{"error":"revision_closed","message":"script 94c52c3f-41d0-4978-9220-7054e22dde24 is approved; revision is closed"}
```

## Testes

- `test/deadline.test.ts`: dia de calendário em São Paulo vs UTC, horário de verão histórico, validação de data, último instante do dia e primeiro do dia seguinte.
- `test/script.test.ts`: todas as transições do domínio, imutabilidade das versões antigas, recusa de reabertura.
- `test/api.test.ts`: fluxo completo via HTTP (`fastify.inject`) com `ManualClock`, incluindo os dois instantes de fronteira do prazo.

## Decisões que eu mudaria

- **Armazenamento em memória.** Some ao reiniciar. Em produção iria para Postgres com versões em tabela própria e controle otimista (`updatedAt`/versão na escrita) para evitar duas aprovações concorrentes.
- **Prazo só validado na criação do pedido.** O enunciado trata o pedido com prazo vencido como inválido, e é isso que está implementado. Um envio de versão depois do prazo continua aceito; eu provavelmente marcaria o pedido como `late` ou expiraria o pedido aberto, mas isso depende da regra de negócio.
- **Aprovação sem número de versão.** `POST /approve` aprova a versão atual. Exigir `{ version }` no corpo evitaria aprovar algo que mudou entre a leitura e o clique.
- **Sem autenticação nem papéis.** Qualquer cliente pode agir como marca ou criador. O próximo passo seria separar quem pede ajuste/aprova (marca) de quem envia versão (criador).
- **Um pedido aberto por vez.** Simplifica o estado; marcas que mandam vários comentários soltos precisariam de agrupamento ou de múltiplos pedidos por versão.
- **Resposta devolve o roteiro inteiro.** Prático aqui; com muitas versões eu paginaria `versions` e devolveria só o recurso criado.

## O que ficou de fora

Persistência, autenticação, notificações de prazo, listagem/paginação de roteiros, diff entre versões, OpenAPI.

## Uso de IA

Código gerado com assistência de IA (Claude Code). O que a IA fez:

- Modelagem do domínio (estados, transições, erros) e da regra de prazo em `America/Sao_Paulo`.
- Implementação da API em Fastify + Zod, do relógio injetável e do repositório em memória.
- Escrita dos testes de domínio, de prazo e de HTTP, incluindo os instantes de fronteira com relógio controlado.
- Execução manual do servidor com `curl` para capturar os exemplos deste README.
- Redação deste README.

Revisao humana: [Rodrigo completa]
