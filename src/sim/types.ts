export type Vec3 = [number, number, number];

export interface ScoreTuning {
  per_mote: number; // v1.1: per firefly DEPOSITED
  per_lantern: number;
  per_stun: number;
  per_second_left: number;
  per_flame_left: number;
}

/** Mirrors game.contract.json "tuning". The sim reads these values from the file (single source of truth). */
export interface Tuning {
  player_speed: number;
  carry_capacity: number;
  lantern_cost: number;
  lantern_count_night1: number;
  pickup_radius: number;
  interact_radius: number;
  pulse_cost: number;
  pulse_radius: number;
  night1_duration_s: number;
  night2_duration_s: number;
  night3_duration_s: number;
  flames: number;
  invuln_s: number;
  hit_drop_ratio: number;
  pulse_stun_s: number;
  pulse_push_m: number;
  pulse_cooldown_s: number;
  safe_radius: number;
  shade_speed: number;
  shade_hit_radius: number;
  dash_speed: number;
  dash_duration_s: number;
  dash_cooldown_s: number;
  fall_enabled: boolean;
  score: ScoreTuning;
}

export interface InputState {
  move: [number, number];
  cam_yaw_deg: number;
  jump: boolean;
  interact: boolean;
  pulse: boolean;
  dash: boolean;
  pause: boolean;
}

export const BUTTONS = ['jump', 'interact', 'pulse', 'dash', 'pause'] as const;
export type Button = (typeof BUTTONS)[number];

export function neutralInput(): InputState {
  return { move: [0, 0], cam_yaw_deg: 0, jump: false, interact: false, pulse: false, dash: false, pause: false };
}

export type ShadeState = 'spawning' | 'wander' | 'chase' | 'recoil' | 'stunned';
export const SHADE_STATES: readonly ShadeState[] = ['spawning', 'wander', 'chase', 'recoil', 'stunned'];
export type DrifterState = 'idle' | 'chase' | 'flee' | 'removed';
export const DRIFTER_STATES: readonly DrifterState[] = ['idle', 'chase', 'flee', 'removed'];
export type GameState = 'playing' | 'paused' | 'won' | 'lost';

export interface ScenarioMote { pos: Vec3; kind?: 'random' | 'dropped'; ttl_ticks?: number }

export interface Scenario {
  player?: {
    pos?: Vec3;
    carried?: number;
    flames?: number;
    invuln_ticks?: number;
    dash_cd_ticks?: number;
    pulse_cd_ticks?: number;
    charm_ticks?: number;
  };
  random_motes?: boolean;
  random_shades?: boolean;
  random_drifters?: boolean;
  wind_enabled?: boolean;
  motes?: ScenarioMote[];
  shades?: { id?: string; pos: Vec3; state?: ShadeState; state_ticks_left?: number }[];
  drifters?: { id?: string; pos: Vec3; state?: DrifterState; stolen?: number }[];
  charms?: { id?: string; pos: Vec3; available?: boolean; respawn_ticks?: number }[];
  lanterns?: { id: string; pos?: Vec3; lit?: boolean; deposited?: number }[];
  time_left_s?: number;
}

export interface GameEvent {
  type: 'event';
  tick: number;
  name: string;
  data: Record<string, unknown>;
}
