import Contacts
import Foundation

/// Maps `CNContact` to the bridge contract. The Notes field is never read (spec: needs an entitlement).
public enum ContactMapping {
    /// Keys the mapping needs; fetch requests and history events must include them.
    public static var keysToFetch: [CNKeyDescriptor] {
        [
            CNContactNamePrefixKey, CNContactGivenNameKey, CNContactMiddleNameKey, CNContactFamilyNameKey,
            CNContactNameSuffixKey, CNContactNicknameKey, CNContactOrganizationNameKey, CNContactJobTitleKey,
            CNContactBirthdayKey, CNContactPhoneNumbersKey, CNContactEmailAddressesKey,
            CNContactPostalAddressesKey, CNContactUrlAddressesKey,
        ] as [CNKeyDescriptor]
    }

    public static func map(_ c: CNContact) -> BridgeContact {
        var fields: [BridgeField] = []
        for p in c.phoneNumbers { add(&fields, .phone, p.label, p.value.stringValue) }
        for e in c.emailAddresses { add(&fields, .email, e.label, e.value as String) }
        for a in c.postalAddresses { add(&fields, .address, a.label, singleLine(a.value)) }
        for u in c.urlAddresses { add(&fields, .url, u.label, u.value as String) }
        return BridgeContact(
            prefix: text(c.namePrefix), givenName: text(c.givenName), middleName: text(c.middleName),
            familyNames: text(c.familyName), suffix: text(c.nameSuffix), nickname: text(c.nickname),
            company: text(c.organizationName), jobTitle: text(c.jobTitle),
            birthday: birthday(c.birthday), fields: fields
        )
    }

    static func text(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private static func add(_ fields: inout [BridgeField], _ kind: ContactFieldKind, _ label: String?, _ value: String) {
        guard let v = text(value) else { return }
        fields.append(BridgeField(kind: kind, label: mapLabel(label), value: v))
    }

    static func mapLabel(_ label: String?) -> String {
        guard let label, !label.isEmpty else { return "other" }
        switch label {
        case CNLabelHome: return "home"
        case CNLabelWork: return "work"
        case CNLabelOther: return "other"
        case CNLabelPhoneNumberMobile, CNLabelPhoneNumberiPhone: return "mobile"
        case CNLabelPhoneNumberMain: return "main"
        default:
            let localized = CNLabeledValue<NSString>.localizedString(forLabel: label)
            return text(localized) ?? "other"
        }
    }

    static func singleLine(_ a: CNPostalAddress) -> String {
        CNPostalAddressFormatter.string(from: a, style: .mailingAddress)
            .split(whereSeparator: \.isNewline).joined(separator: ", ")
    }

    /// `YYYY-MM-DD`, or `--MM-DD` when the year is missing (Contacts uses 1604 as a sentinel).
    static func birthday(_ d: DateComponents?) -> String? {
        guard let d, let month = d.month, let day = d.day else { return nil }
        let md = String(format: "%02d-%02d", month, day)
        if let year = d.year, year != 1604, year > 0 { return String(format: "%04d-", year) + md }
        return "--" + md
    }
}
