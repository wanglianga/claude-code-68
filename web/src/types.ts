export interface User { id: number; username: string; name: string; role: string }

export interface Member {
  id: number; card_no: string; type: 'member' | 'punch';
  holder_name: string; phone: string; remaining_sessions: number;
  benefits: string; valid_until: string; status: string;
  children?: Child[];
}

export interface Child {
  id: number; member_id: number; name: string; gender: string;
  birth_date: string; height_cm: number; allergies: string;
  banned: string; notes?: string;
  guardians?: Guardian[];
  card_no?: string; holder_name?: string;
}

export interface Guardian {
  id: number; child_id: number; name: string; relation: string;
  phone: string; is_authorized: number; is_emergency: number;
}

export interface Attraction {
  id: number; key: string; name: string;
  min_height: number | null; max_height: number | null;
  capacity: number; status: string; is_facility: number;
}

export interface Checkin {
  id: number; child_id: number; member_id: number; guardian_id: number;
  wristband_no: string; sessions_used: number; status: string;
  checkin_at: string; checkout_at: string | null;
  child_name?: string; guardian_name?: string; guardian_phone?: string;
  height_cm?: number; card_no?: string; zone?: string | null;
}

export interface EventItem {
  id: number; code: string; type: string; title: string; description: string;
  child_id: number | null; member_id: number | null; attraction_id: number | null;
  severity: string; status: string; archive: string | null;
  created_by_name: string; created_at: string; resolved_at: string | null;
  child_name?: string | null; attraction_name?: string | null;
}

export interface TimelineEntry {
  id: number; event_id: number; kind: string;
  actor_name: string; actor_role: string;
  content: string; meta: string; created_at: string;
}

export interface PartyChild {
  child_id: number; child_name: string; height_cm: number; allergies: string;
  guardian_id: number; guardian_name: string; relation: string;
  guardian_phone: string; is_authorized: number;
}

export interface Party {
  id: number; type: 'birthday' | 'daycare'; title: string;
  leader_id: number; leader_name: string; area: string;
  start_at: string; end_at: string; status: string;
  children?: PartyChild[];
}

export interface PatrolLog {
  id: number; area: string; status: string; note: string;
  staff_name: string; created_at: string;
}

export interface Overview {
  inside_count: number; daily_limit: number;
  attractions: Attraction[]; occupancy: Record<string, number>;
  open_events: number; processing_events: number;
  today_parties: Party[]; active_checkins: Checkin[]; recent_patrol: PatrolLog[];
}

export interface RecommendResult {
  child: Child;
  eligible: { attraction: Attraction; occupancy: number; ratio: number; reasons: string[]; parties: string[] }[];
  blocked: { attraction: Attraction; reasons: string[] }[];
}

export interface EventDetail {
  event: EventItem; timeline: TimelineEntry[];
  child: Child | null; member: Member | null;
  guardians: Guardian[]; parties: Party[];
}

export interface ArchiveData {
  photos: string[];
  cctv: { camera?: string; start?: string; end?: string; note?: string }[];
  parent_signature: string; compensation: string;
  recheck: { result?: string; inspector?: string } | null;
  benefit_adjustment: { add_sessions?: number; applied_to?: string; note?: string } | null;
  archived_by?: string; archived_at?: string;
}

export interface ReviewResult {
  events: EventItem[];
  stats: {
    byType: Record<string, number>; byAttraction: Record<string, number>;
    byHour: Record<string, number>; bySeverity: Record<string, number>;
    staff: { actor_name: string; actor_role: string; c: number }[];
  };
}
