"""Regression tests for source precedence, late sheets and in-progress matches."""

from datetime import datetime
from pathlib import Path
import tempfile
from unittest import TestCase

from lxml import html

from live import collect, registration, timeline


class MatchDayTest(TestCase):
    def setUp(self):
        self.now = '2026-11-27T19:00:00+07:00'
        self.match = {'id':'vl1-9-NDI-CAH', 'league':'vl1', 'round':9, 'status':'scheduled',
                      'homeClub':'NDI','awayClub':'CAH','date':'2026-11-27','time':'18:00'}
        self.names = ['Thép Xanh Nam Định','Công An Hà Nội']
        self.row = timeline.source['CalendarRow']('2026-11-27', self.names,[0,0],
                                                  'https://vpf.vn/match/example/', '18:00',None,'','58',False)

    def page(self, status):
        teams = ''.join('<div class="jsMatchPartName"><a href="/team/fixture/?sid=154439">'+n+'</a></div>' for n in self.names)
        return html.fromstring('<div id="jsMatchViewID">'+teams+
                               '<div class="matchdtime">27 tháng 11, 2026 - 18:00</div>'+
                               '<div class="jo-match-status">'+status+'</div>'+
                               '<div class="BigMScore1">0</div><div class="BigMScore2">0</div></div>')

    def test_calendar_score_does_not_finalize_live_or_half_time(self):
        for label, expected in [('LIVE','live'),('Nghỉ giữa hiệp','halfTime'),('HT','halfTime')]:
            with self.subTest(label=label):
                result,_ = timeline.read_match(self.page(label),self.match,self.row,self.now)
                self.assertEqual((result['status'],result['score']),(expected,[0,0]))

    def test_full_time_needs_a_matching_calendar(self):
        result,_ = timeline.read_match(self.page('FT'),self.match,self.row,self.now)
        self.assertEqual(result['status'],'final')
        wrong = self.row._replace(score=[1,0])
        result,_ = timeline.read_match(self.page('FT'),self.match,wrong,self.now)
        self.assertIsNone(result)
        result,_ = timeline.read_match(self.page(''),self.match,self.row,self.now)
        self.assertIsNone(result)

    def test_late_sheet_replaces_fallback_and_unreadable_image_keeps_verified_data(self):
        record = {'sheets': [], 'fallback': [
            {'kind':'match-page','squad':{'starters':[{'number':3,'name':'Dự phòng'}],'substitutes':[]}},
            None
        ], 'fixture':collect.identity(self.match),'timeline':None}
        fixture = {'season':'2026/27','matches':{self.match['id']:self.match}}
        squad = {'starters':[{'name':'Romulo Da Silva Machado','number':72}],'substitutes':[]}
        sheet = {'postId':1, 'sha256':'1'*64, 'source':'https://vpf.vn/example/',
                 'image':'https://vpf.vn/wp-content/uploads/a.jpg','publishedAt':self.now,
                 'modifiedAt':self.now,'firstSeenAt':self.now,'teams':[squad,None]}
        errors = []
        collect.record_sheet(record,sheet,errors)
        later = dict(sheet, sha256='2'*64, modifiedAt='2026-11-27T19:10:00+07:00',teams=[None,None])
        collect.record_sheet(record,later,errors)
        self.assertTrue(errors)
        self.assertEqual(len(record['sheets']),2)
        self.assertEqual(collect.reconcile(record)[0]['squad'],squad)
        self.assertIsNone(collect.reconcile(record)[1])
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            now = datetime.fromisoformat(self.now)
            self.assertTrue(collect.export({self.match['id']:record},output,fixture,now))
            self.assertFalse(collect.export({self.match['id']:record},output,fixture,now))
            detail = collect.read(output/'matches'/f'{self.match["id"]}.json',None)
            self.assertEqual(detail['lineup'][0]['kind'],'registration')

    def test_wrong_number_or_skipped_row_does_not_publish(self):
        lines = [registration.ROW.match(f'{i}_ {"TM" if i==1 else "HV"}__{i} Cau Thu {i} 2000')
                 for i in range(1,17)]
        players = [{'number':i,'name':f'Cau Thu {i}'} for i in range(1,17)]
        result = registration.roster_rows(lines,players,16)
        self.assertEqual((len(result['starters']),len(result['substitutes'])),(11,5))
        self.assertIsNone(registration.roster_rows(lines[:-1],players,16))
        players[10]['number'] = 27
        self.assertIsNone(registration.roster_rows(lines,players,16))
