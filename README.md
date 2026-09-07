# Broker Management

Aplicação React/Vite para gestão imobiliária, com autenticação e persistência no Supabase. O Express serve o build de produção como uma SPA.

## Requisitos

- Node.js 18 ou superior
- Um projeto Supabase

## Configuração

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Crie a configuração local do cliente:

   ```bash
   cp client/.env.example client/.env
   ```

3. Preencha `client/.env` com a URL e a chave pública (`anon` ou `publishable`) exibidas em **Supabase → Project Settings → API**:

   ```dotenv
   VITE_SUPABASE_URL=https://seu-projeto.supabase.co
   VITE_SUPABASE_ANON_KEY=sua_chave_publica
   ```

4. Em um projeto Supabase novo, revise e execute `scripts/supabase_schema.sql` no SQL Editor. Antes de executar a seção de exemplo no fim do arquivo, substitua o UUID de usuário pelo `id` de um usuário criado em **Authentication → Users**.

## Desenvolvimento

```bash
npm run dev
```

- Interface Vite: <http://localhost:5173>
- Servidor Express: <http://localhost:3000>

Depois de mudar qualquer variável em `client/.env`, reinicie o processo de desenvolvimento.

## Produção local

```bash
npm run build
npm start
```

A aplicação fica disponível em <http://localhost:3000>.

## Verificações

O comando abaixo valida o TypeScript e gera o bundle de produção:

```bash
npm run build
```

Se a aplicação mostrar **Configuração em falta**, confira os nomes das duas variáveis no `client/.env`. Se o login funcionar mas os dados não carregarem, confira se o usuário possui uma linha correspondente em `public.profiles` e se o `empresa_id` existe em `public.empresas` e `public.empresa_dados`.

## Conta superadmin

O perfil `superadmin` abre um painel administrativo separado. Ele pode cadastrar e excluir imobiliárias, criar e remover seus logins de administrador/corretor e listar esses cadastros. Ele não acessa o CRM nem grava arquivos no Storage.

Os nomes apresentados na interface correspondem aos valores do schema:

- **Master da empresa** (`role = 'empresa'`): vê todos os registros da imobiliária, a equipe e pode abrir a visão de cada corretor.
- **Corretor** (`role = 'corretor'`): a interface mostra somente registros cujo `ownerUserId` corresponde ao seu usuário.
- **Superadmin** (`role = 'superadmin'`): administra imobiliárias e logins, sem entrar no CRM.

1. Execute a seção `011` de `scripts/supabase_schema.sql` no SQL Editor.
2. Crie o usuário em **Authentication → Users**.
3. Copie o UUID do usuário e execute:

   ```sql
   insert into public.profiles (id, empresa_id, role, nome_exibicao)
   values ('UUID_DO_AUTH_USERS', null, 'superadmin', 'Super Admin');
   ```

Ao cadastrar uma imobiliária pelo painel, o sistema cria a linha em `public.empresas`, inicializa `public.empresa_dados`, cria o usuário em Supabase Auth e o vincula em `public.profiles` com o papel escolhido (`empresa` ou `corretor`). Também é possível adicionar corretores e outros masters depois.

Essas operações passam pela Edge Function `superadmin-admin`, que mantém a chave `service_role` somente no ambiente seguro do Supabase. Excluir uma imobiliária remove permanentemente seus logins, perfil e payload do CRM; a interface sempre solicita confirmação antes dessa ação.

O botão **Gerar** cria senhas temporárias fáceis de comunicar no formato `palavra123`. Elas devem ser trocadas pelo usuário depois do primeiro acesso.
