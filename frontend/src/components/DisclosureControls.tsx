import { ChangeEvent } from 'react'

export type DisclosureOptions = {
  minimumAge: number
  ofac: boolean
  nationality: boolean
  name: boolean
  gender: boolean
  dateOfBirth: boolean
  issuingState: boolean
  passportNumber: boolean
  expiryDate: boolean
}

// zkTwitter platform-wide minimum age: 20+
// This is enforced by the platform, not configurable by users
export const ZKTWITTER_MINIMUM_AGE = 20;

export const DEFAULT_DISCLOSURE_OPTIONS: DisclosureOptions = {
  minimumAge: ZKTWITTER_MINIMUM_AGE,
  ofac: false,  // Temporarily disabled for testing age requirement
  nationality: true,
  name: false,
  gender: false,
  dateOfBirth: false,
  issuingState: false,
  passportNumber: false,
  expiryDate: false,
}

export function buildSelfDisclosures(options: DisclosureOptions) {
  const payload: Record<string, boolean | number | string[]> = {
    excludedCountries: [],
    ofac: options.ofac,
  }

  if (options.minimumAge > 0) {
    payload.minimumAge = options.minimumAge
  }

  if (options.nationality) payload.nationality = true
  if (options.name) payload.name = true
  if (options.gender) payload.gender = true
  if (options.dateOfBirth) payload.date_of_birth = true
  if (options.issuingState) payload.issuing_state = true
  if (options.passportNumber) payload.passport_number = true
  if (options.expiryDate) payload.expiry_date = true

  return payload
}

type DisclosureControlsProps = {
  value: DisclosureOptions
  onChange: (next: DisclosureOptions) => void
}

export function DisclosureControls({ value, onChange }: DisclosureControlsProps) {
  const toggle = (key: keyof DisclosureOptions) => (event: ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...value,
      [key]: event.target.checked,
    })
  }

  return (
    <fieldset className="disclosure-controls">
      <legend>Disclosure preferences</legend>

      <div className="disclosure-row">
        <div className="disclosure-label">
          <strong>Age requirement</strong>
          <span className="disclosure-hint">
            zkTwitter requires all users to be 20 years or older. Self will verify your age without revealing your exact birth date.
          </span>
        </div>
        <div style={{ padding: '12px 16px', background: '#1e3a5f', borderRadius: '8px', fontWeight: 'bold', color: '#4a9eff' }}>
          20+ required
        </div>
      </div>

      <div className="disclosure-grid">
        <label className="disclosure-checkbox">
          <input type="checkbox" checked={value.ofac} onChange={toggle('ofac')} />
          <span>
            Enable OFAC screening
            <small>Self flags passports on sanctions lists.</small>
          </span>
        </label>
        <label className="disclosure-checkbox">
          <input type="checkbox" checked={value.nationality} onChange={toggle('nationality')} />
          <span>
            Reveal nationality
            <small>ISO-3 nationality code.</small>
          </span>
        </label>
        <label className="disclosure-checkbox">
          <input type="checkbox" checked={value.name} onChange={toggle('name')} />
          <span>
            Reveal name
            <small>Uses the MRZ full name field.</small>
          </span>
        </label>
        <label className="disclosure-checkbox">
          <input type="checkbox" checked={value.gender} onChange={toggle('gender')} />
          <span>
            Reveal gender
            <small>Single-letter gender code.</small>
          </span>
        </label>
        <label className="disclosure-checkbox">
          <input type="checkbox" checked={value.dateOfBirth} onChange={toggle('dateOfBirth')} />
          <span>
            Reveal birth date
            <small>Full date of birth (DD-MM-YY).</small>
          </span>
        </label>
        <label className="disclosure-checkbox">
          <input type="checkbox" checked={value.issuingState} onChange={toggle('issuingState')} />
          <span>
            Reveal issuing state
            <small>Passport issuing country.</small>
          </span>
        </label>
        <label className="disclosure-checkbox">
          <input type="checkbox" checked={value.passportNumber} onChange={toggle('passportNumber')} />
          <span>
            Reveal passport number
            <small>Only request if necessary.</small>
          </span>
        </label>
        <label className="disclosure-checkbox">
          <input type="checkbox" checked={value.expiryDate} onChange={toggle('expiryDate')} />
          <span>
            Reveal expiry date
            <small>Passport expiry in DD-MM-YY.</small>
          </span>
        </label>
      </div>
    </fieldset>
  )
}

export default DisclosureControls
