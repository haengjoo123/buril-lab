create index if not exists cabinet_activity_logs_performed_by_idx
  on public.cabinet_activity_logs (performed_by);

create index if not exists cabinet_disposal_logs_cabinet_id_idx
  on public.cabinet_disposal_logs (cabinet_id);

create index if not exists cabinet_disposal_logs_disposed_by_idx
  on public.cabinet_disposal_logs (disposed_by);

create index if not exists cabinet_items_cabinet_id_idx
  on public.cabinet_items (cabinet_id);

create index if not exists cabinet_items_shelf_id_idx
  on public.cabinet_items (shelf_id);

create index if not exists cabinet_shelves_cabinet_id_idx
  on public.cabinet_shelves (cabinet_id);

create index if not exists cabinets_lab_id_idx
  on public.cabinets (lab_id);

create index if not exists cabinets_user_id_idx
  on public.cabinets (user_id);

create index if not exists feedback_resolved_by_idx
  on public.feedback (resolved_by);

create index if not exists feedback_user_id_idx
  on public.feedback (user_id);

create index if not exists inventory_product_id_idx
  on public.inventory (product_id);

create index if not exists inventory_storage_location_id_idx
  on public.inventory (storage_location_id);

create index if not exists inventory_user_id_idx
  on public.inventory (user_id);

create index if not exists labs_created_by_idx
  on public.labs (created_by);

create index if not exists reagent_aliases_user_id_idx
  on public.reagent_aliases (user_id);

create index if not exists safety_center_exports_user_id_idx
  on public.safety_center_exports (user_id);

create index if not exists safety_center_lab_links_approved_by_idx
  on public.safety_center_lab_links (approved_by);

create index if not exists safety_center_lab_links_requested_by_idx
  on public.safety_center_lab_links (requested_by);

create index if not exists safety_center_request_events_actor_user_id_idx
  on public.safety_center_request_events (actor_user_id);

create index if not exists safety_center_request_events_request_id_idx
  on public.safety_center_request_events (request_id);

create index if not exists safety_center_requests_created_by_idx
  on public.safety_center_requests (created_by);

create index if not exists safety_centers_approved_by_idx
  on public.safety_centers (approved_by);

create index if not exists safety_centers_created_by_idx
  on public.safety_centers (created_by);

create index if not exists safety_compliance_events_shelf_id_idx
  on public.safety_compliance_events (shelf_id);

create index if not exists storage_locations_user_id_idx
  on public.storage_locations (user_id);

create index if not exists waste_logs_lab_id_idx
  on public.waste_logs (lab_id);

create index if not exists waste_logs_user_id_idx
  on public.waste_logs (user_id);
