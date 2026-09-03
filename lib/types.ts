/** Shared domain types — mirror the database schema in 0001_init.sql. */

export interface Company {
  id: string;
  slug: string;
  name: string;
  website: string | null;
  logo_url: string | null;
  description: string | null;
  ats_type: 'greenhouse' | 'lever' | 'ashby';
  ats_token: string;
}

export interface OfficeLocation {
  id: string;
  company_id: string;
  label: string | null;
  address: string | null;
  city: string;
  city_slug: string;
  is_hq: boolean;
  precision: 'address' | 'poi' | 'city';
}

export interface Job {
  id: string;
  company_id: string;
  location_id: string | null;
  slug: string;
  source_job_id: string;
  title: string;
  department: string | null;
  category: string | null;
  employment_type: string | null;
  workplace_type: 'onsite' | 'hybrid' | 'remote' | null;
  apply_url: string;
  posted_at: string | null;
  is_active: boolean;
}

/** One map marker: an office + its company + how many open roles. */
export interface Pin {
  location_id: string;
  company_slug: string;
  company_name: string;
  logo_url: string | null;
  precision: 'address' | 'poi' | 'city';
  lng: number;
  lat: number;
  open_jobs: number;
}
