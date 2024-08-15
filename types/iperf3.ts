export interface Report {
  start: unknown;
  intervals: unknown;
  end: End;
}

export interface End {
  streams: unknown;
  sum: Stats;
  sum_sent: Stats;
  sum_received: Stats;
  sum_bidir_reverse?: Stats;
  sum_sent_bidir_reverse?: Stats;
  sum_received_bidir_reverse?: Stats;
  cpu_utilization_percent: CpuUtil;
}

export interface Stats {
  bits_per_second: number;
  lost_percent: number;
  sender: boolean;
}

export interface CpuUtil {
  host_total: number;
  remote_total: number;
}
