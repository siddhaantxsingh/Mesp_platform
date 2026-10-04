/** Shared API + live-WebSocket (v1) types for the MESP platform. Mirrors apps/api. */
export type Role = 'viewer' | 'operator' | 'admin'
export type Severity = 'INFO' | 'WARNING' | 'CRITICAL'
export type Quality = 'good' | 'fair' | 'poor'
export type LinkState = 'connecting' | 'connected' | 'streaming' | 'stale' | 'disconnected'
export type Stream = 'ecg' | 'ppg' | 'imu'

export interface Token { access_token: string; role: Role; email: string; demo: boolean; expires_in: number }
export interface Me { id: string; email: string; role: Role; demo: boolean }

export interface DeviceProfile {
  id: string; protocol_version: number; firmware: string; ppg_fifo_hz: number; ppg_adc_bits: number; imu_hz: number
  accel_lsb_per_g: number; gyro_lsb_per_dps: number; ecg_hz: number; ecg_adc_bits: number; ecg_vref: number
  has_battery: boolean; has_skin_temp: boolean; has_display: boolean; source: string
}

export interface LinkStats {
  frames_ok: number; crc_errors: number; lost_frames: number; duplicates: number; frame_errors: number; bytes: number
  clock_gaps: number; latency_ms_p50: number | null; latency_ms_p95: number | null
  samples: Record<Stream, number>
}

export interface Vitals {
  t: number; hr_ecg: number | null; hr_ppg: number | null; spo2: number | null; rr_ms: number | null
  rr_irregularity: number | null; ecg_quality: Quality | null; ppg_quality: Quality | null; perfusion_index: number | null
  motion_g: number | null; activity: 'still' | 'light' | 'active' | null; roll_deg: number | null; pitch_deg: number | null
  imu_temp_c: number | null; battery_soc: number | null; skin_temp_c: number | null; ecg_lead_off?: boolean | null
}

export interface LiveStatus {
  device_id: string; session_id: string; link_state: LinkState; source: string; synthetic: boolean; started_at: number
  profile: DeviceProfile; firmware: string | null; stats: LinkStats; vitals: Vitals | null
  device_reported: Record<string, number> | null
}

export interface Device {
  id: string; name: string; profile_id: string; profile: DeviceProfile; key_prefix: string; simulated: boolean
  firmware: string | null; created_at: number; last_seen: number | null; online: boolean; live: LiveStatus | null
  ingest_key?: string
}

export interface SessionRow {
  id: string; device_id: string; device_name: string | null; started_at: number; ended_at: number | null; duration_s: number
  active: boolean; source: string; synthetic: boolean; profile_id: string; firmware: string | null; label: string | null
  stats: Partial<LinkStats>; data_start?: number | null; data_end?: number | null; event_count?: number
}

export interface MespEvent {
  id: string; device_id: string; session_id: string | null; t: number; severity: Severity; code: string; title: string
  detail: string; stream: Stream | null; data: Record<string, unknown>; synthetic: boolean
  acknowledged_by: string | null; acknowledged_at: number | null; ack_note: string | null
}

export interface SamplesResponse {
  session_id: string; stream: Stream; synthetic: boolean; t_from: number; t_to: number; decimated: boolean; points: number
  source_samples: number; t: (number | null)[]; channels: { name: string; unit: string; values: (number | null)[] }[]
}

export interface Scenario { id: string; title: string; description: string; duration_s: number; expected_events: string[] }
export interface DemoStatus { running: boolean; scenario: string | null; replay: string | null; started_at: number | null; device_id: string | null; session_id: string | null; label: string }

// ---------------------------------------------------------------- live WS v1 (server -> client)
export type LiveMessage =
  | { v: 1; type: 'hello'; user: string; role: Role; server_time: number; devices_online: string[] }
  | { v: 1; type: 'subscribed'; device_id: string; status: LiveStatus | null }
  | { v: 1; type: 'ping'; server_time: number }
  | { v: 1; type: 'samples'; device_id: string; stream: 'ecg'; t0: number; fs: number; gap: boolean; values: number[] }
  | { v: 1; type: 'samples'; device_id: string; stream: 'ppg'; t0: number; fs: number; gap: boolean; red: number[]; ir: number[]; pleth: number[] }
  | { v: 1; type: 'samples'; device_id: string; stream: 'imu'; t0: number; fs: number; gap: boolean; accel: number[][]; gyro: number[][]; mag: number[] }
  | ({ v: 1; type: 'vitals'; device_id: string; session_id: string; synthetic: boolean; link: { loss_ratio: number | null; crc_ratio: number | null }; stats: LinkStats } & Vitals)
  | { v: 1; type: 'event' | 'event_ack'; device_id: string; event: MespEvent }
  | { v: 1; type: 'link'; device_id: string; state: LinkState; reason: string; at: number }
  | { v: 1; type: 'session'; device_id: string; state: 'started' | 'ended'; session_id: string; synthetic?: boolean; source?: string; profile?: DeviceProfile }

export const DISCLAIMER =
  'This system is an engineering/research prototype for physiological monitoring and visualization. It is not a medical device and does not provide a medical diagnosis. Measurements and alerts should not be used as a substitute for professional medical evaluation.'
