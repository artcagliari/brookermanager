import type { AppSection } from "../types";
import { ThemeToggle } from "../ThemeContext";
import { APP_NAME, appNameParts } from "../branding";

export type CrmNavItem = [AppSection, string, string];

type Props = {
  items: CrmNavItem[];
  active: AppSection;
  nome: string;
  role: "empresa" | "corretor";
  email: string;
  onNavigate: (section: AppSection) => void;
  onImport: () => void;
  onExport: () => void;
  onLogout: () => void;
};

function NavButton({
  item,
  active,
  onNavigate,
  mobile = false,
}: {
  item: CrmNavItem;
  active: boolean;
  onNavigate: (section: AppSection) => void;
  mobile?: boolean;
}) {
  const [id, label, path] = item;
  return (
    <button
      type="button"
      onClick={() => onNavigate(id)}
      aria-current={active ? "page" : undefined}
      className={`${mobile ? "shrink-0 min-w-[82px] px-3" : "w-full px-3"} min-h-[46px] rounded-xl flex items-center ${mobile ? "flex-col justify-center gap-1" : "gap-3"} text-left transition-colors ${active ? "bg-emerald-500/15 text-emerald-300" : "text-white/55 hover:bg-white/5 hover:text-white"}`}
    >
      <svg
        className="w-5 h-5 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path strokeWidth={2} d={path} />
      </svg>
      <span
        className={`${mobile ? "text-[9px]" : "text-xs"} font-bold truncate`}
      >
        {label}
      </span>
    </button>
  );
}

export function CrmNavigation(props: Props) {
  const brand = appNameParts(APP_NAME);
  return (
    <>
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-40 w-64 flex-col bg-[#111916] text-white border-r border-white/5 no-print">
        <div className="p-6 border-b border-white/5">
          <p className="text-[9px] font-black uppercase tracking-[0.25em] text-emerald-400">
            CRM Imobiliário
          </p>
          <h1 className="text-xl font-black mt-1">
            {brand.head}{" "}
            <span className="font-light text-emerald-300">{brand.tail}</span>
          </h1>
        </div>
        <nav
          className="flex-1 overflow-y-auto p-3 space-y-1"
          aria-label="Navegação principal"
        >
          {props.items.map((item) => (
            <NavButton
              key={item[0]}
              item={item}
              active={props.active === item[0]}
              onNavigate={props.onNavigate}
            />
          ))}
        </nav>
        <div className="p-4 border-t border-white/5 space-y-3">
          <div className="rounded-xl bg-white/5 p-3 min-w-0">
            <p className="text-xs font-black truncate">
              {props.nome || (props.role === "empresa" ? "Master" : "Corretor")}
            </p>
            <p className="text-[9px] text-white/40 truncate mt-1">
              {props.email}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <ThemeToggle variant="darkHeader" />
            <button
              type="button"
              onClick={props.onExport}
              className="min-h-[40px] rounded-xl bg-white/5 text-[9px] font-bold"
            >
              Backup
            </button>
            <button
              type="button"
              onClick={props.onImport}
              className="min-h-[40px] rounded-xl bg-white/5 text-[9px] font-bold"
            >
              Importar
            </button>
          </div>
          <button
            type="button"
            onClick={props.onLogout}
            className="w-full min-h-[40px] rounded-xl border border-white/10 text-[10px] font-bold text-white/60"
          >
            Sair
          </button>
        </div>
      </aside>

      <header className="lg:hidden sticky top-0 z-40 bg-[#111916] text-white border-b border-white/5 no-print">
        <div className="h-16 px-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[8px] uppercase tracking-[0.2em] text-emerald-400 font-black">
              CRM Imobiliário
            </p>
            <p className="font-black truncate">{APP_NAME}</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle variant="darkHeader" />
            <details className="relative group">
              <summary
                className="list-none cursor-pointer min-h-[40px] min-w-[40px] rounded-xl bg-white/5 flex items-center justify-center font-black"
                aria-label="Opções da conta"
              >
                •••
              </summary>
              <div className="absolute right-0 top-11 z-50 w-40 rounded-xl border border-white/10 bg-[#17211d] p-1.5 shadow-2xl">
                <button
                  type="button"
                  onClick={props.onExport}
                  className="w-full min-h-[40px] rounded-lg px-3 text-left text-xs font-bold hover:bg-white/5"
                >
                  Exportar backup
                </button>
                <button
                  type="button"
                  onClick={props.onImport}
                  className="w-full min-h-[40px] rounded-lg px-3 text-left text-xs font-bold hover:bg-white/5"
                >
                  Importar backup
                </button>
                <button
                  type="button"
                  onClick={props.onLogout}
                  className="w-full min-h-[40px] rounded-lg px-3 text-left text-xs font-bold text-red-300 hover:bg-red-500/10"
                >
                  Sair da conta
                </button>
              </div>
            </details>
          </div>
        </div>
        <nav
          className="flex gap-1 overflow-x-auto px-2 pb-2"
          aria-label="Navegação principal"
        >
          {props.items.map((item) => (
            <NavButton
              key={item[0]}
              item={item}
              active={props.active === item[0]}
              onNavigate={props.onNavigate}
              mobile
            />
          ))}
        </nav>
      </header>
    </>
  );
}
