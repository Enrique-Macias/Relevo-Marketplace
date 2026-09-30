# RLVO — Data Retention Matrix

Status: Product specification
Legal validation: Required

---

# Principle

RLVO should not retain personal information longer than necessary for the documented purpose.

Retention behavior must match:

- database implementation;
- Supabase Storage;
- Supabase Auth;
- moderation records;
- account deletion;
- Privacy Notice.

---

| Data | Normal retention | Account deletion | Notes |
|---|---|---|---|
| Institutional email | While account exists | Delete | Exception for suspended-account hash |
| Password | Managed by Supabase Auth | Delete Auth account | RLVO cannot read plaintext |
| Internal user ID | While account exists | Delete/anonymize as required | Avoid orphaned personal references |
| Registration date | While account exists | Delete unless legitimately anonymized | |
| Last login | Managed by Supabase Auth | Delete with Auth user | |
| Name | While account exists | Delete | |
| University | While account exists | Delete from personal profile | Aggregated non-personal data may be separate |
| Campus | While account exists | Delete from personal profile | |
| Career | While account exists | Delete | Optional |
| Interests | While account exists | Delete | |
| Profile photo | While account exists | Physically delete | Supabase Storage |
| Phone | While account exists | Delete | Private |
| Push token | Until invalid/device removed/account deleted | Delete | |
| Listings | Until user deletes/account deleted | Delete | Sold listings may remain until user deletes |
| Listing photos | Same as listing | Physically delete | Blocked listing exception while listing exists |
| Favorites | While needed | Delete | |
| Contact events | While needed for product/recommendations | Delete personal association | 90-day recommendation window |
| Listing view count | While listing exists | Listing-level aggregate | No per-user browsing history |
| Reviews received | While account exists | Delete | |
| Reviews written | While relevant | Anonymize | Keep stars; remove author and comment |
| Reports | 12 months after resolution | Remove deleted-user identity | |
| Moderation record | 12 months | May remain without unnecessary personal data | No original photos solely for retention |
| Suspended email hash | Product decision: indefinite | Retain only for suspended accounts | Requires legal validation |
| Sentry diagnostics | According to configured operational retention | Avoid unnecessary personal data | Verify Sentry configuration |
| Moderation acceptance record | While necessary to demonstrate applicable user action/version | Review on deletion | Legal retention must be validated |

---

# Recommendation data

Personalized recommendations use:

- interests;
- favorites;
- contact events from the previous 90 days.

This is not a general browsing-history system.

---

# Deleted listings

When a normal listing is deleted:

- delete database record according to relational requirements;
- delete associated photos physically.

For an infringing listing:

A minimal moderation record may remain for 12 months.

Do not retain the original listing photos solely for this record.

---

# Blocked listings

A blocked listing may remain in the system but hidden.

Its photos may remain in Storage while that listing exists.

If the listing/account is permanently deleted, apply the deletion rules.

---

# Reports

Retention:

12 months after resolution.

After account deletion:

remove identity links to the deleted user where the report is retained.

---

# Suspended-account hash

Input:
institutional email.

Transformation:
SHA-256 or approved equivalent implementation.

Purpose:
prevent registration using an institutional email belonging to a previously suspended account.

Only create/retain this value when the account was suspended.

Do not retain the original email for this purpose.

Current product decision:
indefinite retention.

Must be legally validated before production.

---

# Implementation rule

The production database and Storage behavior must be tested against this matrix before release.

Documentation must not promise deletion behavior that the backend does not actually implement.