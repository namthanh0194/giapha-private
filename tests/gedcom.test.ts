import { describe, expect, it } from 'vitest'

import { exportToGedcom, parseGedcom } from '@/utils/gedcom'

describe('GEDCOM sources and citations', () => {
  it('round-trips independent sources and person citations', () => {
    const gedcom = exportToGedcom({
      persons: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          full_name: 'Nguyễn Văn Tổ',
          gender: 'male',
        }
      ],
      relationships: [],
      sources: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          title: 'Gia phả họ Nguyễn',
          source_type: 'document',
          author: 'Nguyễn Văn Cả',
          publisher: 'Nhà thờ họ',
          publication_date: '1930-01-01',
          url: 'https://example.test/giapha',
          repository: 'Tủ sách gia đình',
          note: 'Bản gốc\nĐã số hoá'
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          title: 'Sổ gia đình độc lập',
          source_type: 'book'
        }
      ],
      person_citations: [
        {
          person_id: '11111111-1111-4111-8111-111111111111',
          source_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          field_name: 'birth_date',
          page_reference: 'Trang 12',
          quotation: 'Sinh năm 1880',
          confidence: 'primary'
        }
      ]
    })

    const parsed = parseGedcom(gedcom)

    expect(parsed.sources).toEqual([
      expect.objectContaining({
        title: 'Gia phả họ Nguyễn',
        source_type: 'document',
        author: 'Nguyễn Văn Cả',
        publisher: 'Nhà thờ họ',
        publication_date: '1930-01-01',
        url: 'https://example.test/giapha',
        repository: 'Tủ sách gia đình',
        note: 'Bản gốc\nĐã số hoá'
      }),
      expect.objectContaining({
        title: 'Sổ gia đình độc lập',
        source_type: 'book'
      })
    ])
    expect(parsed.person_citations).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        ),
        person_id: parsed.persons[0].id,
        source_id: parsed.sources.find(
          (source) => source.title === 'Gia phả họ Nguyễn'
        )?.id,
        field_name: 'birth_date',
        page_reference: 'Trang 12',
        quotation: 'Sinh năm 1880',
        confidence: 'primary'
      })
    ])
  })

  it('preserves inline and missing source references', () => {
    const parsed = parseGedcom(`0 HEAD
1 GEDC
2 VERS 7.0
0 @I1@ INDI
1 NAME Nguyễn /Văn A/
1 SOUR Lời kể của trưởng họ
2 PAGE Phỏng vấn 2020
1 SOUR @MISSING@
2 DATA
3 TEXT Bản chép tay thất lạc
0 TRLR`)

    expect(parsed.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Lời kể của trưởng họ',
          source_type: 'other',
          note: 'GEDCOM: 1 SOUR Lời kể của trưởng họ'
        }),
        expect.objectContaining({
          title: 'Nguồn GEDCOM không tồn tại: MISSING',
          source_type: 'other',
          note: 'GEDCOM: 1 SOUR @MISSING@'
        })
      ])
    )
    expect(parsed.person_citations).toHaveLength(2)
    expect(parsed.person_citations.map((citation) => citation.source_id)).toEqual(
      parsed.sources.map((source) => source.id)
    )
  })
})
