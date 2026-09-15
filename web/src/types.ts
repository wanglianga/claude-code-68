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
  /** 走失查找期间：手环出园冻结标记与对应事件编号 */
  lost_frozen?: number; lost_event_code?: string | null;
}

export interface SearchTask {
  id: number; event_id: number; child_id: number;
  wristband_no: string | null; last_zone: string;
  cameras: string; assignments: string; status: string; created_at: string;
}

export interface FoundReport {
  id: number; event_id: number; found_zone: string; companion: string;
  child_state: string; need_comfort: number; taken_by_other: number;
  other_guardian_name: string | null; other_guardian_phone: string | null;
  recorded_by_name: string; created_at: string;
}

export interface SearchAlertItem {
  event_id: number; code: string; status: string; created_at: string;
  child_id: number; child_name: string;
  wristband_no: string | null; last_zone: string | null;
}

// ---------- 设备临停分流 ----------
export interface AffectedChild {
  child_id: number; name: string; height_cm: number;
  wristband_no: string | null; card_no: string; member_id: number; source: string;
}

export interface StopTicket {
  id: number; code: string; attraction_id: number; status: string;
  reason: string; affected: AffectedChild[];
  created_by_name: string; created_at: string; recovered_at: string | null;
  attraction_name?: string; attraction_key?: string; attraction_status?: string;
  waiting_count?: number; voucher_count?: number; open_issue_count?: number;
}

export interface QueueEntry {
  id: number; attraction_id: number; child_id: number; ticket_id: number | null;
  queue_no: string; status: string; transferred_to: string | null; created_at: string;
  child_name?: string; height_cm?: number;
}

export interface Voucher {
  id: number; ticket_id: number; member_id: number; child_id: number | null;
  type: string; amount: string; note: string; applied: number;
  issued_by_name: string; created_at: string;
  card_no?: string; child_name?: string | null;
}

export interface TicketIssue {
  id: number; ticket_id: number; type: string; title: string; detail: string;
  status: string; created_by_name: string; created_at: string;
}

export interface Recheck {
  id: number; attraction_id: number; ticket_id: number;
  photos: string; result: string; inspector: string;
  confirmed_by: string | null; confirmed_at: string | null;
  created_by_name: string; created_at: string;
}

export interface TicketDetail {
  ticket: StopTicket;
  queue: QueueEntry[];
  vouchers: Voucher[];
  issues: TicketIssue[];
  rechecks: Recheck[];
  alternatives: { attraction: Attraction; occupancy: number; suitable: string[] }[];
  compensation_options: string[];
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
  child: Omit<Child, 'banned'> & { banned: string[] };
  eligible: { attraction: Attraction; occupancy: number; ratio: number; reasons: string[]; parties: string[] }[];
  blocked: { attraction: Attraction; reasons: string[] }[];
}

export interface EventDetail {
  event: EventItem; timeline: TimelineEntry[];
  child: Child | null; member: Member | null;
  guardians: Guardian[]; parties: Party[];
  search_task: SearchTask | null; found_report: FoundReport | null;
}

export interface ArchiveData {
  photos: string[];
  cctv: { camera?: string; start?: string; end?: string; note?: string }[];
  parent_signature: string; compensation: string;
  recheck: { result?: string; inspector?: string } | null;
  benefit_adjustment: { add_sessions?: number; applied_to?: string; note?: string } | null;
  /** 留空资料的明确结论（不适用项自动生成或人工填写） */
  conclusions?: Record<string, string>;
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
