import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  Building2,
  ClipboardCheck,
  Download,
  Settings,
  ShieldCheck,
} from 'lucide-react';

export type CenterSection = 'dashboard' | 'labs' | 'risks' | 'requests' | 'exports' | 'settings';

export const SAFETY_CENTER_NAV_ITEMS: Array<{
  section: CenterSection;
  label: string;
  path: string;
  Icon: LucideIcon;
}> = [
  { section: 'dashboard', label: '대시보드', path: '/center', Icon: ShieldCheck },
  { section: 'labs', label: '연구실 연결', path: '/center/labs', Icon: Building2 },
  { section: 'risks', label: '위험 상세', path: '/center/risks', Icon: AlertTriangle },
  { section: 'requests', label: '점검 요청', path: '/center/requests', Icon: ClipboardCheck },
  { section: 'exports', label: '내보내기', path: '/center/exports', Icon: Download },
  { section: 'settings', label: '센터 설정', path: '/center/settings', Icon: Settings },
];

export function getSafetyCenterSectionFromPath(pathname: string): CenterSection {
  if (pathname.startsWith('/center/labs')) return 'labs';
  if (pathname.startsWith('/center/risks')) return 'risks';
  if (pathname.startsWith('/center/requests')) return 'requests';
  if (pathname.startsWith('/center/exports')) return 'exports';
  if (pathname.startsWith('/center/settings')) return 'settings';
  return 'dashboard';
}
